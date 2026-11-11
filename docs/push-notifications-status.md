# Push notifications: where things stand and how to finish

Last updated 2026-11-10. Live site: https://ayaansdq.github.io/ummah/ (GitHub Pages, branch `ummah-app`; `main` is kept in step with it).
No secrets are recorded here. Keys live in `.env` (git-ignored), Supabase secrets and Supabase Vault.

## In one paragraph

The server half (database trigger, then an Edge Function, then OneSignal) is built and was verified end to end on 2026-11-09. The device half has never worked: **OneSignal has 0 subscribers**, so no phone or computer has ever received a push. The likeliest cause is a bad service-worker path and scope in `assets/js/notify.js`, which was written for a site at the domain root but the app lives under `/ummah/`. Fixing that, plus two stale URLs, is the whole remaining job.

---

## 1. How it is supposed to work

```
exec posts an update
  -> row inserted in public.updates
  -> trigger updates_notify_on_change
  -> pg_net HTTP POST (authorised by a Vault secret)
  -> Edge Function notify-post
  -> OneSignal REST API (segment "Subscribed Users")
  -> every subscribed device shows a notification
  -> tap opens <SITE_URL>#post-<id>, and reader.js scrolls to that post
```

| Piece | Role | Where |
|---|---|---|
| Trigger `updates_notify_on_change` | Fires after insert/update on `public.updates`. Sends for a **new active post** or a post **changed to cancelled**. Ignores `exec_meeting` posts and all other edits, deletes and restores. | `supabase/migrations/20260915030000_notify_on_post_change.sql` |
| `pg_net` | Lets Postgres make the HTTP call. Logs every response in `net._http_response` (kept only a few hours). | same migration |
| Vault secret `trigger_service_role_key` | The key the trigger uses to call the function, so nothing secret is in the repo. | Supabase Vault |
| Edge Function `notify-post` | Builds the heading and message, calls OneSignal, sets the tap link. Deployed, ACTIVE, `verify_jwt: true`. | `supabase/functions/notify-post/index.ts` |
| Function secrets | `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `SITE_URL`. | Supabase, Edge Functions, Secrets |
| OneSignal app | Push provider, Web Push, custom-code integration, SDK v16. App ID `90056235-55df-4620-b88c-e216a55f1b4d` (public, safe in client code). | OneSignal dashboard |
| `notify.js` | The "Enable notifications" banner. Initialises OneSignal and subscribes the device. **Runs only in an installed PWA (standalone display mode) on a push-capable browser.** Dismissal is remembered in `localStorage` key `msa-notify-dismissed`. | `assets/js/notify.js`, loaded by `index.html` only |
| `sw.js` | App-shell worker. Also pulls in OneSignal's worker with `importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")`, so one worker does caching and push. | `sw.js` |
| `sw-register.js` | Registers `sw.js` on every page. Its default scope is the folder the worker sits in, so `/ummah/`. | `assets/js/sw-register.js` |
| PWA install | Needed for iOS push, and it gates the prompt. | `manifest.json`, `install.js` |

`view.html` (the exec "View" tab) deliberately has no OneSignal and no install banner.

---

## 2. What is verified and what is not

**Verified working (2026-11-09):**
- Trigger present and enabled. Vault secret present (created 2026-09-15).
- `net._http_response` held 38 responses, all HTTP 200, no errors. The function's reply was `{"ok":true,"result":{"id":"","errors":["All included players are not subscribed"]}}`. That proves the chain ran and OneSignal accepted our app ID and key. There was simply nobody to send to.
- OneSignal reported 0 subscribers and 0 notifications on record.
- The function's `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` match `.env`, and the client app ID matches too.
- The 3 sample exec meetings correctly sent nothing.

**Reported by you:** an early test (app installed on your phone, post made from your computer) produced no notification. You then enabled the Web Push platform in OneSignal and completed the custom-code setup. No later success has been reported and no device has appeared in OneSignal.

**Never confirmed (do not assume either way):**
- Whether `OneSignal.init` succeeds on the live site.
- Whether any browser has ever shown the permission prompt.
- Whether the OneSignal dashboard's Site URL is correct.

---

## 3. Why there are no subscribers (suspects, most likely first)

All unverified. They are hypotheses to test, not findings.

1. **Service-worker path and scope clash.** `notify.js` calls `OneSignal.init` with `serviceWorkerPath: "sw.js"` and `serviceWorkerParam: { scope: "/" }`.
   - The worker is at `/ummah/sw.js`. A worker may only claim scopes at or below its own folder unless the server sends a `Service-Worker-Allowed` header, and GitHub Pages does not. So scope `/` is refused.
   - OneSignal may also resolve `"sw.js"` against the domain root (`/sw.js`), which would be a 404.
   - `sw-register.js` separately registers the same worker at scope `/ummah/`, so the two registrations disagree.
   - The same problem existed under the old `/msa-app/` address, which fits there never having been a subscriber.
2. **OneSignal dashboard Site URL** was set to the old address when last noted and has not been rechecked. It must be `https://ayaansdq.github.io/ummah/`. OneSignal may refuse to initialise on a mismatched origin or path.
3. **`SITE_URL` secret** still holds `https://ayaansdq.github.io/msa-app/` (checked by comparing hashes). The same old address is the fallback in `index.ts` line 12. This breaks the tap-through link, not delivery.
4. **Prompt gating.** The banner shows only in an installed PWA on a push-capable browser, and never again after dismissal. A normal browser tab will never show it, which can look like a bug during testing.
5. **Old installs.** Anything installed from `/msa-app/` points at a dead URL and must be reinstalled from `/ummah/`.

---

## 4. The fix, in order

1. **`notify.js`:** point OneSignal at the real worker and scope. Build both from the page URL so the repo name is not hard-coded, for example `serviceWorkerPath: new URL("sw.js", location.href).pathname` and `serviceWorkerParam: { scope: new URL("./", location.href).pathname }`. Both should resolve to `/ummah/sw.js` and `/ummah/`, matching what `sw-register.js` already registers. Bump the `notify.js` version string in `index.html`, and bump `CACHE_NAME` in `sw.js`.
2. **OneSignal dashboard:** set the Site URL to `https://ayaansdq.github.io/ummah/` (Settings, Web Push configuration). This is a dashboard change only you can make.
3. **`SITE_URL` secret:** `npx supabase secrets set SITE_URL=https://ayaansdq.github.io/ummah/` (needs `--yes` from the agent).
4. **`index.ts`:** change the fallback on line 12 to the `/ummah/` address and redeploy: `npx supabase functions deploy notify-post`.
5. **Test device:** uninstall any old copy, then install the PWA fresh from `/ummah/`. On an iPhone this needs iOS 16.4 or newer and the home-screen icon. Desktop Chrome can install it too, which is the quickest place to test. Clear `msa-notify-dismissed` from `localStorage` if the banner was dismissed.
6. **Confirm a subscriber:** open the installed app, tap Enable, accept the prompt, and check the OneSignal dashboard (Audience, Subscriptions) for 1 subscriber. If none appears, open the browser console on the installed app and read the `OneSignal.init` error. That error will say which of the suspects above is real.
7. **Test with one post:** make a single real post, then watch `net._http_response` and the device.

Useful check at any time:

```sql
select created, status_code, content from net._http_response order by created desc limit 10;
```

---

## 5. Cautions

- **Spam risk once there are subscribers.** The trigger sends one push for **every** active post inserted, regardless of event time. Seeding 24 sample posts would send 24 notifications. Before inserting test data, run `alter table public.updates disable trigger updates_notify_on_change;` and re-enable it afterwards. Also decide whether back-dated or far-future posts should notify at all.
- **Redeploy after editing `index.ts`.** Changing a secret alone needs no redeploy.
- **Supabase CLI.** Run `npx supabase ...` with `SUPABASE_ACCESS_TOKEN` exported from `.env`. The current token expires about **2026-12-09** ("Invalid access token" means it lapsed). It was pasted into chat, so revoke it when done. Production writes need `--yes`, reads use `--read-only`. `secrets list` shows only hashes.
- **Free-tier pause.** The project paused once for inactivity (2026-11-07). There is still no keep-alive workflow, so it can pause again after about 7 idle days, and a paused project cannot send anything.

---

## 6. Other loose ends (not push)

- `supabase/migrations/20261108000000_post_media_priority.sql` is still unapplied, so pinned posts, priority and images do not work live.
- Admin login is now username-only (placeholder identifiers, see `supabase/ADMIN-ACCOUNTS.md`). Public sign-up should stay off in Supabase Auth; I have not independently confirmed that setting.
- `msa-app-spec.md` still describes email and password login.
- `ummah-app` and `main` currently point at the same commit. The local remote URL is already `https://github.com/AyaanSDQ/ummah.git`.
