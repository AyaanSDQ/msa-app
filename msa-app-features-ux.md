# MSA App — Features, UX Flow & Component Plan

Builds on `msa-app-spec.md`. This document covers product behavior, not implementation.

---

## 1. Functional Features

### Everyone (no login required)

- View the **hero card**: the single soonest active, non-cancelled, non-deleted post (prayer or event), rendered from a type-specific template.
- View **today's other posts** section (everything else posted for today besides the hero); shows a defined empty state if none exist.
- View **history**: all past posts, grouped by date with headers, paginated via "Load more" rather than one unbounded list.
- See a **relative "last updated" timestamp** on every post ("Updated 12 minutes ago").
- See a **cancelled badge** on posts marked cancelled — post stays visible, styled distinctly.
- Submit **feedback** on posts flagged as feedback-eligible (event-type posts, exec toggle per post) — available any time the post exists (before/during/after), unlimited submissions, no login, tied to that post's ID. Feedback itself is not publicly visible.
- See **live updates** (new posts, cancellations, edits to the hero) via Supabase Realtime — no manual refresh.
- **Install as a PWA** (Android: guided install prompt; iOS: manual walkthrough with screenshots; in-app browsers: detected and redirected to open in a real browser).
- **Receive push notifications** on new posts (where supported), deep-linking to the specific post via a URL anchor.
- **Never** see: exec-meeting posts, deleted posts, or any feedback content.

### Executives (logged in, Supabase Auth email/password, pre-created accounts)

- **Log in / log out.**
- View the **full events list**, a superset of the public view: includes exec-meeting posts, shows cancelled posts inline (badge), shows deleted posts inline (greyed out + trash icon + status label) — no separate trash page.
- **Create a post** via an expandable "+ New Post" form at the top of the list (not a separate screen): type selector (prayer / social / announcement / exec meeting) drives which fields appear; draft is retained in memory if the form is collapsed via **Discard**, cleared only on page reload; on submit failure, the form stays open with entered values intact and shows an inline error.
- **Open an individual post's detail page** (reached from the list) to: view all feedback submitted on that post, **Cancel** it, **Delete** it (soft delete), or **Restore** it (if currently deleted).
- Every post shows **attribution** (posted by which exec) in both the list and detail views.
- **No in-app edit** — corrections are made by posting a new post of the same type, which becomes the new current/hero (by design, see spec §7).
- **No in-app executive-roster management** — adding/removing who counts as an exec is handled outside the app (Ayaan manages the `executives` table directly after execs send their name/email).

---

## 2. UX Flow

### Reader — single page, no navigation

```
Load page
   |
   v
[Hero Card]  — the one thing visible without scrolling
   |
   v
[Today's Other Posts]  (or empty state)
   |
   v
──────── divider ────────
   |
   v
[History, grouped by date, "Load more" at bottom]
```

- Tapping a feedback-eligible post expands an inline feedback row in place — no page change.
- Arriving via a push notification lands on this same page, auto-scrolled to the relevant post via anchor.
- A loading skeleton (not a blank screen) shows during the initial data fetch.

### Executive — two views, same page, gated by auth

```
Log in
   |
   v
[Events List]  (default view)
   |-- "+ New Post" → expands Post Form in place, collapses on Discard/Submit
   |-- tap any post -->
   v
[Event Detail Page]
   - full post info
   - feedback list
   - Cancel / Delete / Restore (conditional on current status)
   - back → returns to Events List
```

No router needed — a single `currentView: 'list' | 'detail'` state toggle inside the same authenticated shell.

---

## 3. Components Per Page

### Reader page

| Component | Produces |
|---|---|
| `PostCard` (type-aware) | Renders differently for prayer / social / announcement, used for both the hero and every other listed post |
| `RelativeTimestamp` | "Updated 12 minutes ago" line on every card |
| `StatusBadge` | Cancelled indicator overlay on a `PostCard` |
| `EmptyState` | "No update posted yet for today" placeholder |
| `FeedbackRow` (expandable) | Inline feedback form under an eligible post |
| `HistoryGroup` | Date-header + list of `PostCard`s for one day |
| `LoadMoreButton` | Pagination trigger for history |
| `InstallPrompt` | Contextual Android/iOS/in-app-browser install guidance |
| `SkeletonCard` | Loading placeholder shown pre-fetch |

### Exec — Events List view

| Component | Produces |
|---|---|
| `NewPostToggle` | "+ New Post" button that expands/collapses the form |
| `PostForm` (type-aware) | Dynamic fields per selected type, `Discard` + `Submit` actions, inline error banner |
| `PostCard` (exec variant) | Same shell as reader's, plus: exec-meeting type visible, `TrashBadge` for deleted posts |
| `TrashBadge` | Greyscale treatment + trash icon + "Deleted" label on a deleted post |
| `AttributionTag` | "— Zach" style signature on each post |

### Exec — Event Detail page

| Component | Produces |
|---|---|
| `PostCard` (expanded/full detail variant) | Full info view of the single post |
| `FeedbackList` | All feedback entries submitted for this post |
| `ActionBar` | Cancel / Delete / Restore buttons, only the relevant ones shown per current status |
| `BackNav` | Returns to Events List |

---

## 4. Visual Cues & Styling Direction

**One consistent card shell, differentiated by a colored accent, not a different layout per type** — keeps the whole app visually legible as "these are all the same kind of thing" while still making type instantly scannable:

| Type | Accent color | Icon |
|---|---|---|
| Prayer | Green | Minaret glyph |
| Social | Orange | People/calendar glyph |
| Announcement | Blue | Megaphone glyph |
| Exec meeting (exec-only) | Purple | Briefcase glyph |

- **Status states are visually distinct from type**, so they're never confused:
  - **Cancelled** — a red banner strip across the card, text unchanged, card keeps its normal color otherwise.
  - **Deleted** (exec view only) — full desaturation to greyscale + a small trash-can icon badge in the corner. Greyscale is reserved exclusively for this state so it's never ambiguous with anything else.
- **Hero card typography**: large, bold numerals for the time/room ("Room 2205," "1:10–1:25") — this is the one piece of text that should be readable at a glance from arm's length; notes paragraph underneath in smaller, regular weight.
- **Relative timestamps and attribution** stay small and muted (light grey, smaller type) — present for trust, but not competing visually with the primary info.
- **Expandable elements** (feedback row, post form, history groups if you revisit collapsing) use a chevron that rotates on open, with a smooth height transition rather than an abrupt show/hide — makes "there's more here" self-evident without needing a label.
- **Button semantics, color-coded consistently app-wide**:
  - Primary/submit actions — filled, brand color (e.g., green).
  - Neutral actions like **Discard** — outlined, grey, low visual weight.
  - Destructive actions (**Cancel Event**, **Delete**) — outlined or filled red, distinct from Discard so a tired exec can't misclick one for the other.
  - **Restore** — a distinct third color (e.g., blue outline) so it doesn't read as either "undo the discard" or "another destructive action."
- **Empty states** get a small muted icon + one line of friendly text, never just blank space — reinforces that the app is working, not broken.
- **PWA installed-mode spacing**: respect `env(safe-area-inset-top)` so the hero card's padding clears the iOS notch/Android status bar in standalone mode.
