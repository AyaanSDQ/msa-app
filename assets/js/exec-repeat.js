// The "Repeat" control on the New post form. It reads the date and time already
// entered above it, so there is nothing to type twice, and turns the choices into
// a recurrence rule (see recurrence.js).

import { parseKey, summaryLine, validateRule } from "./recurrence.js?v=2";

export function setupRepeat(form) {
  const $ = (id) => form.querySelector(`#${id}`);
  const select = $("repeat-select");
  const panel = $("repeat-panel");
  const daysBox = $("rep-days");
  const endsSelect = $("rep-ends");
  const endDate = $("rep-end-date");
  const endCount = $("rep-end-count");
  const summary = $("repeat-summary");
  const chips = [...daysBox.querySelectorAll(".day-chip")];
  let touchedDays = false;

  // The date and time typed in the Time field ("2026-11-17T19:00").
  function startParts() {
    const v = form.event_time.value;
    if (!v) return null;
    const [date, time = ""] = v.split("T");
    return { date, time };
  }

  function setChips(days) {
    chips.forEach((c) => {
      const on = days.includes(Number(c.dataset.day));
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", String(on));
    });
  }
  const pressed = () => chips.filter((c) => c.classList.contains("on")).map((c) => Number(c.dataset.day));

  function sync() {
    const on = select.value !== "none";
    panel.hidden = !on;
    daysBox.hidden = select.value !== "weekly";
    endDate.hidden = endsSelect.value !== "on";
    endCount.hidden = endsSelect.value !== "count";
    if (select.value === "weekly" && !touchedDays) {
      const sp = startParts();
      setChips([sp ? parseKey(sp.date).getDay() : new Date().getDay()]);
    }
    updateSummary();
  }

  // Returns { rule } (null when the post does not repeat) or { error }.
  function build() {
    if (select.value === "none") return { rule: null };
    const sp = startParts();
    if (!sp || !sp.time) return { error: "Set the date and time above first. A repeating post needs both." };
    const rule = {
      v: 1,
      freq: select.value,
      interval: 1,
      start: sp.date,
      time: sp.time,
      ends: { type: "never" },
      changes: [],
    };
    if (rule.freq === "weekly") rule.weekdays = pressed();
    if (endsSelect.value === "on") rule.ends = { type: "on", date: endDate.value };
    if (endsSelect.value === "count") rule.ends = { type: "count", count: Number(endCount.value) };
    const error = validateRule(rule);
    return error ? { error } : { rule };
  }

  function updateSummary() {
    if (select.value === "none") {
      summary.textContent = "";
      return;
    }
    const { rule, error } = build();
    summary.textContent = rule ? summaryLine(rule) : error;
    summary.classList.toggle("is-error", !rule);
  }

  function reset() {
    select.value = "none";
    endsSelect.value = "never";
    endDate.value = "";
    endCount.value = "10";
    touchedDays = false;
    setChips([]);
    sync();
  }

  select.addEventListener("change", sync);
  [endsSelect, endDate, endCount].forEach((el) => {
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
  });
  form.event_time.addEventListener("input", sync);
  form.event_time.addEventListener("change", sync);
  daysBox.addEventListener("click", (e) => {
    const chip = e.target.closest(".day-chip");
    if (!chip) return;
    touchedDays = true;
    chip.classList.toggle("on");
    chip.setAttribute("aria-pressed", String(chip.classList.contains("on")));
    // never leave a weekly rule with no days
    if (!pressed().length) {
      chip.classList.add("on");
      chip.setAttribute("aria-pressed", "true");
    }
    updateSummary();
  });

  reset();
  return { build, reset, sync };
}
