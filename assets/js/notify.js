import { icon } from "./icons.js";

// Public OneSignal App ID — a public identifier meant to ship in client
// code (same trust model as the Supabase anon key), not a secret.
const ONESIGNAL_APP_ID = "90056235-55df-4620-b88c-e216a55f1b4d";
const DISMISS_KEY = "msa-notify-dismissed";

const banner = document.getElementById("notify-banner");

// Push only works on iOS when launched from the home screen icon
// specifically (not a normal Safari tab, even post-install), and there's
// no reason to ask desktop/regular-tab visitors either — this is exactly
// what "already running standalone" tells us, so gate on it before ever
// loading the SDK or showing anything.
if (banner && isStandaloneLaunch() && supportsPush()) {
  initNotifyBanner(banner);
}

function isStandaloneLaunch() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function supportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function initNotifyBanner(banner) {
  if (wasDismissed()) return;

  if (Notification.permission === "denied") {
    renderBlocked(banner);
    return;
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      // Reuse our own app-shell service worker (step 5) instead of
      // OneSignal's default OneSignalSDKWorker.js — sw.js imports
      // OneSignal's worker script via importScripts so the two coexist
      // in one registration rather than fighting over root scope.
      serviceWorkerPath: "sw.js",
      serviceWorkerParam: { scope: "/" },
    });

    if (OneSignal.Notifications.permission && OneSignal.User.PushSubscription.optedIn) {
      return; // already enabled — nothing to ask
    }

    renderPrompt(banner, OneSignal);
  });
}

function renderPrompt(banner, OneSignal) {
  show(banner, `
    ${icon("i-bell", { size: 20, stroke: 2.5 })}
    <div class="install-copy">
      <div class="install-title">Enable notifications</div>
      <div class="install-sub">Get notified the moment a new update or cancellation is posted.</div>
    </div>
    <button type="button" class="btn btn-primary" id="notify-action">Enable</button>
  `);

  document.getElementById("notify-action").addEventListener("click", async () => {
    const btn = document.getElementById("notify-action");
    btn.disabled = true;
    btn.textContent = "Requesting…";

    await OneSignal.Notifications.requestPermission();

    if (OneSignal.Notifications.permission) {
      await OneSignal.User.PushSubscription.optIn();
      hide(banner);
    } else {
      btn.disabled = false;
      btn.textContent = "Enable";
    }
  });
}

function renderBlocked(banner) {
  show(banner, `
    ${icon("i-bell", { size: 20, stroke: 2.5 })}
    <div class="install-copy">
      <div class="install-title">Notifications are blocked</div>
      <div class="install-sub">Your browser has notifications turned off for this site. Enable them in your browser/site settings to get update alerts.</div>
    </div>
  `);
}

function show(banner, html) {
  banner.innerHTML = `${html}<button type="button" class="install-dismiss" id="notify-dismiss" aria-label="Dismiss">${icon("i-close", { size: 14, stroke: 2.75 })}</button>`;
  banner.hidden = false;
  document.getElementById("notify-dismiss").addEventListener("click", () => {
    dismiss();
    hide(banner);
  });
}

function hide(banner) {
  banner.hidden = true;
  banner.innerHTML = "";
}

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // private browsing / storage blocked — fine, just won't be remembered
  }
}
