// Tiny touch niceties for phones: a light haptic tick on taps (Android/Chrome;
// iOS ignores it) for the controls people press most.
(() => {
  if (!("vibrate" in navigator)) return;
  const TAPPABLE = ".tab, .btn, .seg-btn, .cal-day, .cal-arrow, .type-option, .rating-star";
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      if (e.target.closest?.(TAPPABLE)) navigator.vibrate(6);
    },
    { passive: true },
  );
})();
