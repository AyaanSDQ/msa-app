import { icon } from "./icons.js";

const DISMISS_KEY = "msa-install-dismissed";

const banner = document.getElementById("install-banner");
if (banner) initInstallBanner(banner);

function initInstallBanner(banner) {
  if (isStandalone()) return; // already installed/running as the PWA — never show
  if (wasDismissed()) return;

  let deferredPrompt = null;

  // Android/Chrome: capture the native prompt instead of letting the browser
  // show its own mini-infobar, so we can trigger it from our own button.
  // This event is the whole basis for detecting "Chrome install is possible
  // here" — never assume it fires (many browsers/contexts never send it).
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderAndroid();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hide();
  });

  if (isInAppBrowser()) {
    renderInAppBrowser();
  } else if (isIOSSafari()) {
    renderIOS();
  }
  // Otherwise: wait silently for beforeinstallprompt (or nothing happens,
  // e.g. a desktop browser without install support — that's fine, no UI).

  function renderAndroid() {
    show(`
      ${icon("i-download", { size: 20, stroke: 2.5 })}
      <div class="install-copy">
        <div class="install-title">Install MSA Updates</div>
        <div class="install-sub">Quick access from your home screen, plus notifications for last-minute changes.</div>
      </div>
      <button type="button" class="btn btn-primary" id="install-action">Install</button>
    `);
    document.getElementById("install-action").addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      hide();
    });
  }

  function renderIOS() {
    show(`
      ${icon("i-share", { size: 20, stroke: 2.5 })}
      <div class="install-copy">
        <div class="install-title">Install MSA Updates</div>
        <div class="install-sub">
          <ol class="install-steps">
            <li>Tap ${icon("i-share", { size: 14, stroke: 2.75 })} <b>Share</b> in Safari's toolbar</li>
            <li>Scroll down and tap <b>Add to Home Screen</b></li>
          </ol>
        </div>
      </div>
    `);
  }

  function renderInAppBrowser() {
    show(`
      ${icon("i-share", { size: 20, stroke: 2.5 })}
      <div class="install-copy">
        <div class="install-title">Open in your browser</div>
        <div class="install-sub">This link is open inside another app. For install and notifications, open it in Chrome or Safari instead.</div>
      </div>
    `);
  }

  function show(html) {
    banner.innerHTML = `${html}<button type="button" class="install-dismiss" id="install-dismiss" aria-label="Dismiss">${icon("i-close", { size: 14, stroke: 2.75 })}</button>`;
    banner.hidden = false;
    document.getElementById("install-dismiss").addEventListener("click", () => {
      dismiss();
      hide();
    });
  }

  function hide() {
    banner.hidden = true;
    banner.innerHTML = "";
  }
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// navigator.standalone only ever exists on iOS Safari's WebKit — a feature
// check, not user-agent string parsing, and the only reliable signal we
// have for "this is iOS Safari" (matchMedia/standalone above only tell us
// whether we're ALREADY installed, not which platform we're on).
function isIOSSafari() {
  return typeof window.navigator.standalone !== "undefined";
}

// No feature-detection API exists for "running inside an in-app webview";
// this is the one place a light, narrowly-scoped user-agent check is
// actually necessary, not a general platform-detection substitute for the
// two checks above.
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Instagram|FBAN|FBAV|TikTok|BytedanceWebview|Line\//i.test(ua);
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
