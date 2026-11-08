// Small touch niceties: today's date in the top bar, and a light haptic tick
// on taps (Android/Chrome; iOS ignores it) for the controls people press most.
(() => {
  const dateEl = document.querySelector("[data-today]");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  // The bottom bar slips away while reading (scrolling down) and returns on the
  // way back up, at the top of the page, and at the very end.
  const nav = document.querySelector(".bnav");
  if (nav) {
    let lastY = window.scrollY;
    let queued = false;
    const update = () => {
      queued = false;
      const y = window.scrollY;
      const dy = y - lastY;
      const nearTop = y < 60;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
      if (nearTop || nearBottom || dy < -6) nav.classList.remove("is-hidden");
      else if (dy > 6) nav.classList.add("is-hidden");
      if (Math.abs(dy) > 6) lastY = y;
    };
    window.addEventListener("scroll", () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    document.addEventListener("focusin", () => nav.classList.remove("is-hidden"));
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
