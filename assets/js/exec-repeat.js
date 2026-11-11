// The "Repeat" control on the New post form. It reads the date and time already
// entered above it, so there is nothing to type twice, and turns the choices into
// a recurrence rule (see recurrence.js).

import { WEEKDAY_LONG, parseKey, summaryLine, validateRule } from "./recurrence.js?v=1";

const NTH = ["", "1st", "2nd", "3rd", "4th"];

export function setupRepeat(form) {
  const $ = (id) => form.querySelector(`#${id}`);
  const select = $("repeat-select");
  const panel = $("repeat-panel");
  const customRow = $("rep-custom");
  const intervalInput = $("rep-interval");
  const unitSelect = $("rep-unit");
  const daysBox = $("rep-days");
  const monthlyRow = $("rep-monthly");
  const monthlySelect = $("rep-monthly-mode");
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

  // "daily" | "weekly" | "monthly" once Custom's unit is taken into account.
  const freq = () => (select.value === "custom" ? unitSelect.value : select.value);

  function setChips(days) {
    chips.forEach((c) => {
      const on = days.includes(Number(c.dataset.day));
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", String(on));
    });
  }
  const pressed = () => chips.filter((c) => c.classList.contains("on")).map((c) => Number(c.dataset.day));

  // Monthly choices that make sense for the chosen date: "On day 14", "On the 2nd Friday", "On the last Friday".
  function syncMonthlyOptions() {
    const sp = startParts();
    const d = sp ? parseKey(sp.date) : new Date();
    const wd = d.getDay();
    const nth = Math.ceil(d.getDate() / 7);
    const isLast = d.getDate() + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const options = [["day", `On day ${d.getDate()}`]];
    if (nth <= 4) options.push(["nth", `On the ${NTH[nth]} ${WEEKDAY_LONG[wd]}`]);
    if (isLast) options.push(["last", `On the last ${WEEKDAY_LONG[wd]}`]);
    const keep = monthlySelect.value;
    monthlySelect.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join("");
    if (options.some(([v]) => v === keep)) monthlySelect.value = keep;
  }

  function sync() {
    const on = select.value !== "none";
    const f = freq();
    panel.hidden = !on;
    customRow.hidden = select.value !== "custom";
    daysBox.hidden = !(on && f === "weekly");
    monthlyRow.hidden = !(on && f === "monthly");
    endDate.hidden = endsSelect.value !== "on";
    endCount.hidden = endsSelect.value !== "count";
    if (on && f === "weekly" && !touchedDays) {
      const sp = startParts();
      setChips([sp ? parseKey(sp.date).getDay() : new Date().getDay()]);
    }
    if (on && f === "monthly") syncMonthlyOptions();
    updateSummary();
  }

  // Returns { rule } (null when the post does not repeat) or { error }.
  function build() {
    if (select.value === "none") return { rule: null };
    const sp = startParts();
    if (!sp || !sp.time) return { error: "Set the date and time above first. A repeating post needs both." };
    const d = parseKey(sp.date);
    const f = freq();
    const rule = {
      v: 1,
      freq: f,
      interval: select.value === "custom" ? Number(intervalInput.value) : 1,
      start: sp.date,
      time: sp.time,
      ends: { type: "never" },
      changes: [],
    };
    if (f === "weekly") rule.weekdays = pressed();
    if (f === "monthly") {
      const mode = monthlySelect.value;
      rule.monthly = mode === "day"
        ? { mode: "day", day: d.getDate() }
        : { mode: "nth", nth: mode === "last" ? 5 : Math.ceil(d.getDate() / 7), weekday: d.getDay() };
    }
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
    unitSelect.value = "daily";
    intervalInput.value = "2";
    endsSelect.value = "never";
    endDate.value = "";
    endCount.value = "10";
    touchedDays = false;
    setChips([]);
    sync();
  }

  select.addEventListener("change", sync);
  [unitSelect, intervalInput, monthlySelect, endsSelect, endDate, endCount].forEach((el) => {
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
