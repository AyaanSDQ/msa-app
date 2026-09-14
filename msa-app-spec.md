# MSA Prayer & Events Update App — Full Spec

**Status:** Draft v2 (merged technical + product spec)
**Owner:** Ayaan
**Stakeholder:** MSA President
**Build tools:** Claude Design (UI drafting) → Claude Code (implementation)

---

## 1. Problem Statement

The MSA currently pushes prayer-time/location and event updates via Instagram, StudentSquare, and email. Students don't reliably check these, and last-minute changes (room swaps, cancellations) fail to reach people in time. A previous attempt to solve this with a "real app" was abandoned because native app development + backend infrastructure was assumed too complex/expensive for a student club.

## 2. Goals

- Students can open one link/icon and immediately see the current prayer location/timing and event info — no stale cached content.
- Last-minute changes reach students in near-real-time, ideally via push notification, without them having to check manually.
- Only the 6 club executives can post updates; everyone else is read-only.
- Zero ongoing cost. No paid hosting, database, or notification service.
- Works on: personal Android phones, personal iPhones, and school-managed Chromebooks (Google Workspace for Education, filtered by Lightspeed).
- Easy to understand at a glance, but not so minimal it can't be explored via scrolling.

## 3. Non-Goals

- Not a native iOS/Android app (no App Store/Play Store distribution).
- Not a general-purpose club management platform — scope is limited to prayer/event info and update-posting.
- Not designed to scale beyond a single club's membership (~30–50 users).
- No in-app editing of posts (corrections are new posts — see §9) or in-app executive roster management (see §11).

## 4. Users & Roles

| Role | Count | Access |
|---|---|---|
| Student (reader) | ~30+ | Read-only, no login required |
| Executive (writer) | 6 | Authenticated, can post/cancel/delete updates |

---

## 5. Architecture Overview

```
[Browser / Installed PWA]
        |
        |  static HTML/JS/CSS (no server-side rendering)
        v
[GitHub Pages]  <-- hosts the frontend, free, HTTPS by default
        |
        |  Supabase JS SDK (REST + Realtime WebSocket) using public anon key
        v
[Supabase]
   - Postgres DB (updates, executives, feedback tables)
   - Row Level Security (RLS) enforces read/write rules
   - Supabase Auth (email/password) for exec login
   - Realtime replication (WebSocket) pushes DB changes to open clients
   - Edge Function: triggered by DB webhook on new/changed update -> calls push provider

[Push Provider: Firebase Cloud Messaging or OneSignal]
   - Delivers notification to subscribed devices via each platform's
     native push channel (FCM for Android/Chrome, APNs-via-WebKit for iOS)
```

No backend server is run by us. GitHub Pages serves static files only; all dynamic behavior (data, auth, live updates, push triggering) is handled by Supabase and the push provider directly from the browser or via Supabase Edge Functions.

## 6. Tech Stack & Hosting Decision

| Component | Choice | Why |
|---|---|---|
| Frontend hosting | GitHub Pages | Free, static, HTTPS built in. No server-side code needed since Supabase is called directly from the browser using the public anon key (security lives in RLS, not in hiding the key). |
| Frontend build | Plain HTML/CSS/JS preferred, or React+Vite if more comfortable | Plain JS avoids a build pipeline entirely for GitHub Pages; React+Vite needs a GitHub Actions build step but offers a mature PWA plugin. |
| Backend / DB | Supabase (free tier), own account (not Lovable Cloud) | Postgres + Auth + Realtime + Edge Functions, all free at this scale; own account preserves direct dashboard control. |
| Live updates | Supabase Realtime (Postgres change stream over WebSocket) | Replaces a manual "reload" button — static hosting does not prevent dynamic, real-time client behavior. |
| Push notifications | Firebase Cloud Messaging (FCM) or OneSignal | Free; abstracts VAPID key management and per-platform quirks. Triggered from a Supabase Edge Function, not built by hand. |
| Auth | Supabase Auth, email/password (NOT Google OAuth) | Avoids Google Workspace for Education's "admin needs to review this app" OAuth block on school-managed student accounts — a Supabase email/password call never touches Google's consent flow. |
| UI drafting | Claude Design → handoff bundle | Draft/compare the reader page, exec list+form, and event detail page; hand off directly to Claude Code rather than screenshotting. |
| Implementation | Claude Code | Builds from this spec + the Claude Design handoff bundle. |

**Vercel is not needed** unless a future feature requires custom server-side logic beyond what a Supabase Edge Function can do.

## 7. Data Model

```sql
-- Prayer/social/announcement/exec-meeting posts
create table updates (
  id uuid primary key default gen_random_uuid(),
  type text not null,                     -- 'prayer' | 'social' | 'announcement' | 'exec_meeting'
  status text not null default 'active',  -- 'active' | 'cancelled' | 'deleted'
  title text not null,
  body text,                              -- notes paragraph
  location text,
  event_time timestamptz,
  accepts_feedback boolean default false, -- exec toggle per post
  posted_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Allowlist of who is permitted to write, independent of any Google identity
create table executives (
  user_id uuid primary key references auth.users(id),
  display_name text,
  active boolean default true
);

-- Feedback tied to a specific post, exec-visible only
create table feedback (
  id uuid primary key default gen_random_uuid(),
  update_id uuid references updates(id),
  body text,
  rating int,
  created_at timestamptz default now()
);
```

RLS policies (conceptual):
- `updates` `SELECT` for `anon`: allowed where `type != 'exec_meeting'` and `status != 'deleted'`.
- `updates` `SELECT` for authenticated execs: all rows, no filter.
- `updates` `INSERT`/`UPDATE` (posting, cancelling, deleting, restoring — all just status/row changes): only if `auth.uid()` exists in `executives` with `active = true`.
- `feedback` `INSERT`: allowed for `anon` (write-only, no read).
- `feedback` `SELECT`: exec-only.

Deletion is a **soft delete** (`status = 'deleted'`), not a real `DELETE FROM` — this keeps the row in the Realtime `UPDATE` stream (a hard delete only broadcasts the primary key by default), preserves attribution, and allows restore. Corrections are handled by posting a new row, not editing an existing one, keeping `updates` naturally append-only and giving every post an honest fresh timestamp.

## 8. Authentication & Authorization

- **Readers:** no login. RLS grants `SELECT` on `updates` to the `anon` role (excluding exec-meeting and deleted rows) and `INSERT` on `feedback`.
- **Executives:** Supabase Auth email/password. Accounts are **pre-created by Ayaan** after execs send their name/email — no public self-signup, no in-app roster management screen (infrequent turnover doesn't justify building one; also doubles as a personal check-in with each new exec).
- Authorization for writes is enforced at the database layer via RLS checking membership in the `executives` table, not by any client-side check — a client-only gate is not a real security boundary, since the anon key and all client code are visible via browser dev tools.
- OAuth (Google Sign-In) was considered and rejected for exec login specifically because Google Workspace for Education blocks unconfigured third-party OAuth apps for under-18 managed accounts by default ("Access blocked: your institution's admin needs to review [app]"). This is a Google Admin Console policy, separate from Lightspeed, and would require an IT approval step Supabase email/password avoids entirely.

## 9. PWA / Install Strategy

This is a standards-based Progressive Web App (manifest + service worker), not a disguised browser shortcut — Chrome/Android renders a chrome-less "standalone" window because the manifest requests it.

| Platform | Install path | Notes |
|---|---|---|
| Android / Chrome | `beforeinstallprompt` event → custom "Install" button, or manual "Add to Home Screen" | Chrome decides eligibility — cannot be forced. |
| iOS / Safari | Manual only: Share → Add to Home Screen | No `beforeinstallprompt` equivalent on iOS; onboarding needs a screenshot walkthrough. |
| In-app browsers (Instagram/TikTok, etc.) | Not reliably supported | Detect and instruct users to open the link in Chrome/Safari first. |
| School Chromebooks | Run as a normal browser tab, not installed | Acceptable by design — Chromebook users aren't expected to install. |

Detection: `window.matchMedia('(display-mode: standalone)').matches` (Android/desktop) and `window.navigator.standalone` (iOS) — not user-agent sniffing.

Icon requirement: manifest `icons` array needs dedicated 192x192 and 512x512px assets (plus a maskable variant) — the browser-tab favicon is not sufficient.

Service worker must call `skipWaiting()`/`clients.claim()` so installed clients pick up new deploys rather than serving a stale cached copy indefinitely.

## 10. Push Notifications

- **Android/Chrome:** works in a normal tab; install not required.
- **iOS/Safari:** requires iOS 16.4+, the site installed to the home screen, **and** launched via that home screen icon specifically (a regular Safari tab has no push access even post-install).
- Permission flow: one-time — user opens the installed app, taps an in-app "Enable Notifications" action (real user gesture required), grants permission. No need to keep the app open afterward; delivery happens in the background.
- Delivery mechanism: Supabase database webhook (on `INSERT`/relevant `UPDATE` to `updates`) → Supabase Edge Function → FCM/OneSignal API → delivered to subscribed devices.
- Notifications deep-link to the specific post via a URL anchor (`#post-<id>`), auto-scrolling the reader page to it on open.
- Known limitation: iOS web push has documented reliability inconsistencies (notifications occasionally stop, requiring the app to be reopened to "re-wake" the subscription) — accepted platform limitation, not fixable client-side.

## 11. Deployment & Free-Tier Operations

- **Supabase free-tier pausing:** projects pause after 7 days with no database activity. Mitigation: a GitHub Actions scheduled workflow every 3 days performs an actual DB read/write (not just a GET request) to reset the inactivity timer.
- **Backups:** free tier has no automated backup retention. Mitigation: periodic manual CSV export of `updates`/`feedback`.
- **Deploy pipeline:** push to `main` → GitHub Pages serves updated static files (build step only if using React+Vite).

---

## 12. Functional Features

### Everyone (no login required)

- View the **hero card**: the single soonest active, non-cancelled, non-deleted post, rendered from a type-specific template.
- View **today's other posts** section (empty state if none).
- View **history**: past posts, grouped by date, paginated via "Load more."
- See a **relative "last updated" timestamp** on every post.
- See a **cancelled badge** on cancelled posts — stays visible, styled distinctly.
- Submit **feedback** on feedback-eligible posts (exec toggle per post) — available any time the post exists, unlimited submissions, no login, tied to that post's ID, not publicly visible.
- See **live updates** via Supabase Realtime — no manual refresh.
- **Install as a PWA** with platform-appropriate guidance (Android prompt / iOS manual walkthrough / in-app-browser redirect).
- **Receive push notifications**, deep-linked to the relevant post.
- **Never** see exec-meeting posts, deleted posts, or feedback content.

### Executives (logged in)

- **Log in / log out.**
- View the **full events list** — superset of the public view: exec-meeting posts included, cancelled posts shown inline with a badge, deleted posts shown inline greyed out with a trash icon and status label (no separate trash page).
- **Create a post** via an expandable "+ New Post" form at the top of the list: type selector (prayer / social / announcement / exec meeting) drives which fields appear. **Discard** collapses the form while retaining entered values in memory (cleared only on page reload). On submit failure, the form stays open with values intact and shows an inline error.
- **Open an individual post's detail page** to: view all feedback on that post, **Cancel**, **Delete** (soft delete), or **Restore** it.
- Every post shows **attribution** (posted by which exec).

---

## 13. UX Flow

### Reader — single page, no navigation

```
Load page
   |
   v
[Hero Card]  -- the one thing visible without scrolling
   |
   v
[Today's Other Posts]  (or empty state)
   |
   v
-------- divider --------
   |
   v
[History, grouped by date, "Load more" at bottom]
```

- Tapping a feedback-eligible post expands an inline feedback row in place.
- Arriving via push notification lands here, auto-scrolled to the relevant post.
- A loading skeleton (not a blank screen) shows during the initial fetch.

### Executive -- two views, same page, gated by auth

```
Log in
   |
   v
[Events List]  (default view)
   |-- "+ New Post" -> expands Post Form in place, collapses on Discard/Submit
   |-- tap any post -->
   v
[Event Detail Page]
   - full post info
   - feedback list
   - Cancel / Delete / Restore (conditional on current status)
   - back -> returns to Events List
```

No router needed — a single `currentView: 'list' | 'detail'` state toggle inside the same authenticated shell.

---

## 14. Components Per Page

### Reader page

| Component | Produces |
|---|---|
| `PostCard` (type-aware) | Renders differently for prayer / social / announcement, used for the hero and every listed post |
| `RelativeTimestamp` | "Updated 12 minutes ago" line |
| `StatusBadge` | Cancelled indicator overlay |
| `EmptyState` | "No update posted yet for today" placeholder |
| `FeedbackRow` (expandable) | Inline feedback form under an eligible post |
| `HistoryGroup` | Date-header + list of `PostCard`s for one day |
| `LoadMoreButton` | Pagination trigger for history |
| `InstallPrompt` | Contextual Android/iOS/in-app-browser install guidance |
| `SkeletonCard` | Loading placeholder shown pre-fetch |

### Exec -- Events List view

| Component | Produces |
|---|---|
| `NewPostToggle` | "+ New Post" button that expands/collapses the form |
| `PostForm` (type-aware) | Dynamic fields per type, `Discard` + `Submit` actions, inline error banner |
| `PostCard` (exec variant) | Same shell as reader's, plus: exec-meeting type visible, `TrashBadge` for deleted posts |
| `TrashBadge` | Greyscale + trash icon + "Deleted" label |
| `AttributionTag` | "— Zach" style signature |

### Exec -- Event Detail page

| Component | Produces |
|---|---|
| `PostCard` (expanded/full detail variant) | Full info view of the single post |
| `FeedbackList` | All feedback entries for this post |
| `ActionBar` | Cancel / Delete / Restore, only relevant ones shown per current status |
| `BackNav` | Returns to Events List |

---

## 15. Visual Cues & Styling Direction

One consistent card shell, differentiated by colored accent, not a different layout per type:

| Type | Accent color | Icon |
|---|---|---|
| Prayer | Green | Minaret glyph |
| Social | Orange | People/calendar glyph |
| Announcement | Blue | Megaphone glyph |
| Exec meeting (exec-only) | Purple | Briefcase glyph |

- **Status states are visually distinct from type:**
  - **Cancelled** — red banner strip across the card, colors otherwise unchanged.
  - **Deleted** (exec-only) — full greyscale + trash-can badge; greyscale reserved exclusively for this state.
- **Hero card typography**: large, bold numerals for time/room; notes paragraph underneath in smaller, regular weight.
- **Relative timestamps and attribution**: small, muted, present but not competing for attention.
- **Expandable elements**: rotating chevron + smooth height transition, not abrupt show/hide.
- **Button semantics, color-coded consistently**: primary/submit — filled brand color; **Discard** — outlined grey, low weight; destructive (**Cancel**, **Delete**) — red; **Restore** — a distinct third color (e.g., blue outline).
- **Empty states**: small muted icon + one line of text, never blank space.
- **PWA installed-mode spacing**: respect `env(safe-area-inset-top)` for the iOS notch/Android status bar.

---

## 16. Known Constraints & Risks

| Risk | Mitigation / Status |
|---|---|
| School's Lightspeed filter or network policy blocks the GitHub Pages / Supabase domain | Test on an actual school Chromebook early; escalate to IT if blocked. |
| Google Workspace Admin blocks any future OAuth-based feature for student accounts | Avoided by using Supabase email/password instead of Google Sign-In. |
| iOS push reliability gaps | Documented, accepted limitation; keep Instagram as a redundant channel initially. |
| Stale service worker cache after deploys | `skipWaiting()`/`clients.claim()` in service worker. |
| Supabase free project auto-pause | GitHub Actions heartbeat every 3 days performing a real query. |
| No backup on free tier | Manual periodic export. |
| A leaked exec credential could post a false but plausible update | Individual exec accounts (not shared code) so a compromised login is revocable individually. |
| Cancelled/deleted visually confused by execs | Reserve greyscale exclusively for deleted; cancelled keeps full color + red banner. |
| Unbounded history page weight over a semester | Date-grouping + "Load more" pagination cap. |

## 17. Open Action Items

- [ ] Confirm with school IT whether the target domain(s) are reachable through Lightspeed on Chromebooks.
- [ ] Design and export proper 192x192 / 512x512 (+ maskable) app icons.
- [ ] Decide FCM vs. OneSignal.
- [ ] Pre-create the 6 executive accounts in Supabase Auth and populate the `executives` table.
- [ ] Build onboarding screens: Android install prompt, iOS manual walkthrough, in-app-browser redirect message.
- [ ] Set up the GitHub Actions Supabase keep-alive workflow.
- [ ] Draft reader page, exec list+form, and event detail page in Claude Design; hand off to Claude Code.

## 18. Out of Scope (Future Consideration)

- Native app wrappers (Capacitor/Cordova) if PWA limitations become blocking.
- Multi-language support.
- Migrating off free tiers if usage grows beyond club size.
