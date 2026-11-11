# Push notifications: status and resume notes

Written 2026-11-09 (branch `ummah-app`, live at https://ayaansdq.github.io/ummah/).
No secrets are recorded here; keys live in `.env` (git-ignored) and Supabase.

**One-line summary:** the server half (database trigger → Edge Function → OneSignal) is built and was verified end to end today. The browser half (a device actually subscribing) has never been confirmed to work: OneSignal has **0 subscribers**, so no notification has ever reached a phone or computer.

---

## 1. Components (what makes it work)

| Piece | What it is | Where |
|---|---|---|
| Postgres trigger `updates_notify_on_change` | Fires after insert/update on `public.updates`. Sends a push event for a **new active post** or a post **changed to cancelled**. Skips `exec_meeting` and every other change (edits, deletes, restores). | `supabase/migrations/20260915030000_notify_on_post_change.sql` |
| `pg_net` extension | Lets the trigger make an HTTP POST from inside Postgres. Keeps a log in `net._http_response`. | same migration |
| Supabase Vault secret `trigger_service_role_key` | Holds the service-role key the trigger uses to call the function (so no secret is in the repo). | Supabase Vault |
| Edge Function `notify-post` | Receives the trigger's POST, builds the heading/message, calls OneSignal's REST API (`POST https://api.onesignal.com/notifications`, segment "Subscribed Users"), and sets the click link to `<SITE_URL>#post-<id>`. Deployed (ACTIVE, version 1, `verify_jwt: true`). | `supabase/functions/notify-post/index.ts` |
| Edge Function secrets | `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `SITE_URL` (plus Supabase's own). | Supabase → Edge Functions → Secrets |
| OneSignal (Web Push) | Push provider. Custom-code web integration, SDK v16. App ID is public and is in `notify.js`. | OneSignal dashboard |
| Client prompt `notify.js` | Shows the "Enable notifications" banner, asks for permission, subscribes the device. **Only runs when the site is launched as an installed PWA** (standalone display mode) on a browser that supports push. Dismissal is remembered in `localStorage` key `msa-notify-dismissed`. | `assets/js/notify.js`, loaded by `index.html` (not by `view.html`) |
| Service worker `sw.js` | Our app-shell worker; it pulls in OneSignal's worker with `importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")` so one worker handles both caching and push. | `sw.js` |
| `sw-register.js` | Registers `sw.js` on every page (default scope = the folder it sits in, i.e. `/ummah/`). | `assets/js/sw-register.js` |
| PWA install flow | Needed for iOS push (iOS only allows push from the home-screen app) and gates the prompt. | `manifest.json`, `install.js` |
| Supabase CLI via `npx supabase` | How I reach the project. Uses the token in `.env`. | see "Notes" |

Flow: exec posts → row inserted → trigger → `pg_net` POST → `notify-post` → OneSignal → every subscribed device → tap opens `<SITE_URL>#post-<id>` and `reader.js` scrolls to that post.

---

## 2. What should be working now, and what shouldn't

**Should be working (server side):**
- Trigger is installed and enabled; Vault key exists.
- Edge Function is deployed; its OneSignal App ID and REST key are the same ones in `.env` and the client.
- OneSignal accepts our API calls.

**Should NOT be working yet (client side / links):**
- A device subscribing. The OneSignal setup in `notify.js` is almost certainly incompatible with hosting under `/ummah/` (see section 4). Until that is fixed, expect no subscribers.
- Notification click links. The `SITE_URL` secret still holds the **old** address `https://ayaansdq.github.io/msa-app/` (verified by comparing its hash), which now returns 404. The same old address is the fallback default in `index.ts`.
- Anything installed from the old `/msa-app/` address. That install points at a dead URL; reinstall from `/ummah/`.
- Notifications for exec meetings: intentionally never sent.

---

## 3. What has and hasn't worked (evidence)

**Confirmed working, checked 2026-11-09:**
- Trigger present and enabled on `public.updates`.
- Vault secret `trigger_service_role_key` present (created 2026-09-15).
- `net._http_response` holds 38 responses, **all HTTP 200, no errors**. The latest batch came from the 24 non-exec sample posts inserted today (the 3 exec meetings correctly sent nothing).
- The function's response body for those calls: `{"ok":true,"result":{"id":"","errors":["All included players are not subscribed"]}}`. That proves the whole chain ran and OneSignal accepted the app ID and key. It simply had nobody to send to.
- OneSignal REST check: **0 players/subscribers**, 0 notifications on record.
- `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` in the function match `.env`; the client's app ID matches too.

**Reported by you:**
- Early test: installed the app on your phone (not logged in), posted an event from your computer, **no notification arrived**. This is the only end-to-end device result either of us has reported, and it was a failure.
- You then enabled the Web Push platform in OneSignal (it had been reporting push as not enabled) and completed the custom-code setup step. **No later success was ever reported, and no device has appeared in OneSignal since.**

**Never confirmed (do not assume either way):**
- Whether `OneSignal.init` succeeds on the live site.
- Whether any browser or phone ever received a permission prompt or a notification.
- Whether the OneSignal dashboard's Site URL is set correctly (see below).

---

## 4. Suspected causes, in order (all unverified)

1. **Service-worker path and scope.** `notify.js` calls `OneSignal.init` with `serviceWorkerPath: "sw.js"` and `serviceWorkerParam: { scope: "/" }`. The site lives at `https://ayaansdq.github.io/ummah/`, so `sw.js` is at `/ummah/sw.js`. A worker can't claim scope `/` from inside `/ummah/` (GitHub Pages doesn't send the `Service-Worker-Allowed` header), and OneSignal may resolve `"sw.js"` against the domain root, which is a 404. The same problem existed under the old `/msa-app/` address, so this is the likeliest reason there has never been a subscriber. Likely fix: point OneSignal at `/ummah/sw.js` with scope `/ummah/` (ideally built from the page URL so it doesn't hard-code the repo name).
2. **OneSignal dashboard Site URL** was set to the old address (noted earlier, never rechecked). It must match `https://ayaansdq.github.io/ummah/`.
3. **`SITE_URL` secret** is stale (affects the tap-through link, not delivery).
4. **Prompt gating.** The banner only appears in an installed PWA on a push-capable browser, and never again after it's dismissed. A normal browser tab will never show it, which can look like "broken" during testing.

---

## 5. Notes to remember when resuming

- **Spam risk once there are subscribers:** the trigger sends one push for **every** active post inserted, with no regard to event time. Seeding sample data (24 posts last time) would have sent 24 notifications. Before inserting test data again, disable the trigger (`alter table public.updates disable trigger updates_notify_on_change;`) and re-enable afterward. Also decide whether back-dated or far-future posts should notify at all.
- **Redeploy needed** after changing `index.ts` (the default URL inside it should also be updated). `SITE_URL` itself is changed with `npx supabase secrets set SITE_URL=https://ayaansdq.github.io/ummah/`.
- **CLI:** run `npx supabase ...` with `SUPABASE_ACCESS_TOKEN` exported from `.env`. The new token has a **30-day expiry (about 2026-12-09)**; "Invalid access token" means it lapsed again. The token was pasted into chat, so revoke it when done. Production writes need `--yes`; reads use `--read-only`. `npx supabase secrets list` shows only hashes.
- **Testing realistically:** use an installed PWA (desktop Chrome can install it too; iPhones need iOS 16.4+ and the home-screen icon). Clear `msa-notify-dismissed` in `localStorage` if you dismissed the banner. After a subscriber shows up in OneSignal, insert or cancel one real post to test.
- **`pg_net` log:** `select created, status_code, content from net._http_response order by created desc;` is the quickest way to see whether the trigger fired and what OneSignal said. It is only kept for a few hours.
- **View tab:** `view.html` deliberately has no OneSignal or install banner.
- **Other loose ends (not push):** `20261108000000_post_media_priority.sql` is still unapplied (pinned/priority/image don't work live); public sign-up is still enabled in Supabase Auth; no keep-alive workflow yet, so the free-tier project can pause again after about 7 idle days; `ummah-app` has not been merged into `main`.
- **Next step when we resume:** fix the OneSignal service-worker path/scope, update the OneSignal dashboard Site URL and the `SITE_URL` secret, redeploy the function, reinstall the PWA from `/ummah/` on a test device, get one subscriber to appear, then test with a single post.
