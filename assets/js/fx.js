// Small touch niceties: today's date in the top bar, and a light haptic tick
// on taps (Android/Chrome; iOS ignores it) for the controls people press most.
(() => {
  const dateEl = document.querySelector("[data-today]");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  if (!("vibrate" in navigator)) return;
  const TAPPABLE = ".bnav-item, .btn, .seg-btn, .cal-day, .cal-arrow, .type-option, .rating-star";
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      if (e.target.closest?.(TAPPABLE)) navigator.vibrate(6);
    },
    { passive: true },
  );
})();
