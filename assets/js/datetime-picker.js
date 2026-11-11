// The app's own date and time picker for computers (a mouse or trackpad).
//
// Phones and tablets keep the native picker, which is already good there. On a
// computer the browser's own picker looks different on every system (and badly on
// Windows), so this swaps it for one that matches the rest of the app.
//
// It enhances existing inputs in place: type="datetime-local", "date" or "time".
// The original input stays in the page (hidden) and keeps holding the value in the
// same format ("2026-11-17T19:00", "2026-11-17", "19:00"), so forms, validation and
// `input` / `change` listeners keep working exactly as before.

import { icon } from "./icons.js?v=13";

// Mouse or trackpad as the main pointer. Touch devices are left alone.
const IS_COMPUTER = !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// "19:05" -> { h12: 7, min: 5, pm: true }
function splitTime(t) {
  const [h, m] = (t || "12:00").split(":").map(Number);
  return { h12: h % 12 === 0 ? 12 : h % 12, min: m || 0, pm: h >= 12 };
}
const joinTime = ({ h12, min, pm }) => `${pad((h12 % 12) + (pm ? 12 : 0))}:${pad(min)}`;
const label12 = (t) => {
  const { h12, min, pm } = splitTime(t);
  return `${h12}:${pad(min)} ${pm ? "PM" : "AM"}`;
};

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i)); // a Sunday-first week

let nextId = 1;

function enhance(input) {
  if (input.dataset.dtp) return;
  input.dataset.dtp = "1";

  const mode = input.type; // "datetime-local" | "date" | "time"
  const hasDate = mode !== "time";
  const hasTime = mode !== "date";
  const required = input.required;
  input.required = false; // the page checks its own required fields; a hidden input cannot show the browser's message
  input.type = "text"; // plain storage; the format of the value is unchanged
  input.classList.add("dtp-src");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");

  const uid = `dtp-${nextId++}`;
  const wrap = document.createElement("span");
  wrap.className = "dtp";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = `dtp-trigger ${input.className.replace("dtp-src", "").trim()}`;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const name = input.getAttribute("aria-label") || input.closest(".field")?.querySelector("label")?.firstChild?.textContent?.trim() || "date and time";
  trigger.setAttribute("aria-label", name);
  const pop = document.createElement("div");
  pop.className = "dtp-pop";
  pop.id = uid;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", hasDate ? (hasTime ? "Choose a date and time" : "Choose a date") : "Choose a time");
  pop.hidden = true;
  trigger.setAttribute("aria-controls", uid);
  wrap.append(trigger);
  document.body.append(pop); // on the page itself, so no card or panel can clip it
  input.insertAdjacentElement("afterend", wrap);

  // Clicking the field's label opens the picker (it used to focus the input).
  if (input.id) document.querySelector(`label[for="${input.id}"]`)?.addEventListener("click", () => trigger.focus());

  // ── value helpers ──
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const read = () => {
    const v = nativeValue.get.call(input);
    if (mode === "datetime-local") {
      const [date = "", time = ""] = v.split("T");
      return { date, time: time.slice(0, 5) };
    }
    return mode === "date" ? { date: v, time: "" } : { date: "", time: v.slice(0, 5) };
  };

  let view = new Date(); // month on screen
  let open = false;
  let focusKey = null; // day that has keyboard focus in the grid

  function fieldText() {
    const { date, time } = read();
    if (!date && !time) return "";
    const d = date ? fromKey(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "";
    const t = time ? label12(time) : "";
    return [d, t].filter(Boolean).join(" · ");
  }

  function paintTrigger() {
    const text = fieldText();
    const ph = hasDate ? (hasTime ? "Select date and time" : "Select date") : "Select time";
    trigger.innerHTML = `<span class="dtp-icon">${icon(hasDate ? "i-calendar" : "i-clock", { size: 16 })}</span><span class="dtp-text${text ? "" : " is-empty"}">${text || ph}</span>`;
  }

  function commit(date, time) {
    let v = "";
    if (mode === "datetime-local") v = date ? `${date}T${time || "12:00"}` : "";
    else if (mode === "date") v = date;
    else v = time;
    nativeValue.set.call(input, v);
    paintTrigger();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Code that sets input.value (for example when a form is filled in) keeps the field text right.
  Object.defineProperty(input, "value", {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(v) { nativeValue.set.call(this, v); paintTrigger(); },
  });
  input.form?.addEventListener("reset", () => setTimeout(paintTrigger, 0));

  // The picker follows the input's own `hidden` flag (other code shows and hides it).
  const syncHidden = () => { wrap.hidden = input.hidden; if (input.hidden) close(); };
  new MutationObserver(syncHidden).observe(input, { attributes: true, attributeFilter: ["hidden"] });

  // ── drawing ──
  function render() {
    const { date, time } = read();
    const todayKey = keyOf(new Date());
    const y = view.getFullYear();
    const m = view.getMonth();
    let html = "";

    if (hasDate) {
      const first = new Date(y, m, 1);
      const start = addDays(first, -first.getDay());
      const cells = [];
      for (let i = 0; i < 42; i += 1) {
        const d = addDays(start, i);
        const k = keyOf(d);
        const cls = ["dtp-day"];
        if (d.getMonth() !== m) cls.push("is-out");
        if (k === todayKey) cls.push("is-today");
        if (k === date) cls.push("is-selected");
        const tab = k === (focusKey || date || todayKey) ? 0 : -1;
        cells.push(`<button type="button" class="${cls.join(" ")}" data-k="${k}" tabindex="${tab}" aria-label="${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}"${k === date ? ' aria-pressed="true"' : ""}>${d.getDate()}</button>`);
      }
      html += `<div class="dtp-cal"><div class="dtp-head">
          <button type="button" class="dtp-nav" data-nav="-1" aria-label="Previous month">${icon("i-chev", { size: 16 })}</button>
          <div class="dtp-title" aria-live="polite">${view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
          <button type="button" class="dtp-nav dtp-next" data-nav="1" aria-label="Next month">${icon("i-chev", { size: 16 })}</button>
        </div>
        <div class="dtp-week" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>`).join("")}</div>
        <div class="dtp-grid" role="grid">${cells.join("")}</div></div>`;
    }

    if (hasTime) {
      const t = splitTime(time || "12:00");
      const set = !!time; // nothing is highlighted until a time has been chosen
      const col = (name, items, isOn) => `<div class="dtp-col" role="listbox" aria-label="${name}" data-col="${name.toLowerCase()}">${items.map(([v, text]) => `<button type="button" class="dtp-opt${isOn(v) ? " is-on" : ""}" role="option" aria-selected="${isOn(v)}" data-v="${v}">${text}</button>`).join("")}</div>`;
      html += `<div class="dtp-time${hasDate ? " has-date" : ""}">
          ${col("Hour", Array.from({ length: 12 }, (_, i) => { const h = i === 0 ? 12 : i; return [h, String(h)]; }), (v) => set && v === t.h12)}
          ${col("Minute", Array.from({ length: 60 }, (_, i) => [i, pad(i)]), (v) => set && v === t.min)}
          ${col("Period", [["AM", "AM"], ["PM", "PM"]], (v) => set && (v === "PM") === t.pm)}
        </div>`;
    }

    html = `<div class="dtp-body">${html}</div>` + `<div class="dtp-foot">
        ${hasDate ? `<button type="button" class="dtp-link" data-act="today">Today</button>` : `<button type="button" class="dtp-link" data-act="now">Now</button>`}
        ${required ? "" : `<button type="button" class="dtp-link" data-act="clear">Clear</button>`}
        <button type="button" class="dtp-done" data-act="done">Done</button>
      </div>`;
    pop.innerHTML = html;

    scrollColumns();
  }

  // Keep the chosen time in view in each scrolling column (needs the picker to be showing).
  function scrollColumns() {
    pop.querySelectorAll(".dtp-col").forEach((c) => {
      const on = c.querySelector(".is-on");
      if (on && c.scrollHeight > c.clientHeight) c.scrollTop = on.offsetTop - c.clientHeight / 2 + on.offsetHeight / 2;
    });
  }

  // Sit below the field (or above it when there is more room), kept inside the window.
  function place() {
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    let top = below >= h || below >= above ? r.bottom + 8 : r.top - 8 - h;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }
  const reposition = () => { if (open) place(); };

  function openPicker() {
    if (open) return;
    const { date } = read();
    view = date ? fromKey(date) : new Date();
    focusKey = date || keyOf(new Date());
    render();
    pop.hidden = false;
    open = true;
    trigger.setAttribute("aria-expanded", "true");
    place();
    scrollColumns();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    (pop.querySelector(`.dtp-day[tabindex="0"]`) || pop.querySelector(".dtp-opt.is-on") || pop.querySelector("button"))?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
  }

  function close(returnFocus = false) {
    if (!open) return;
    pop.hidden = true;
    open = false;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    if (returnFocus) trigger.focus();
  }

  const outside = (e) => { if (!wrap.contains(e.target) && !pop.contains(e.target)) close(); };

  // Redraw but keep keyboard focus where it was.
  function redraw(focusSelector) {
    render();
    place();
    if (focusSelector) pop.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function pickDay(k) {
    const { time } = read();
    commit(k, time || "12:00");
    focusKey = k;
    const d = fromKey(k);
    view = d;
    if (!hasTime) return close(true);
    redraw(`.dtp-day[data-k="${k}"]`);
  }

  function pickTime(next, colName) {
    const { date } = read();
    const t = splitTime(read().time || "12:00");
    const merged = { ...t, ...next };
    const dateKey = date || keyOf(new Date());
    commit(hasDate ? dateKey : "", joinTime(merged));
    redraw(`[data-col="${colName}"] .is-on`);
  }

  // ── events ──
  trigger.addEventListener("click", () => (open ? close(true) : openPicker()));
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !open) { e.preventDefault(); openPicker(); }
  });

  pop.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1);
      focusKey = keyOf(new Date(view.getFullYear(), view.getMonth(), Math.min(fromKey(focusKey || keyOf(view)).getDate(), 28)));
      return redraw(`[data-nav="${nav.dataset.nav}"]`);
    }
    const day = e.target.closest(".dtp-day");
    if (day) return pickDay(day.dataset.k);
    const opt = e.target.closest(".dtp-opt");
    if (opt) {
      const col = opt.closest(".dtp-col").dataset.col;
      const v = opt.dataset.v;
      if (col === "hour") pickTime({ h12: Number(v) }, col);
      else if (col === "minute") pickTime({ min: Number(v) }, col);
      else pickTime({ pm: v === "PM" }, col);
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "today") {
      const k = keyOf(new Date());
      view = new Date();
      commit(k, read().time || "12:00");
      focusKey = k;
      return hasTime ? redraw(`.dtp-day[data-k="${k}"]`) : close(true);
    }
    if (act === "now") {
      const n = new Date();
      commit("", `${pad(n.getHours())}:${pad(n.getMinutes())}`);
      return redraw(".dtp-opt.is-on");
    }
    if (act === "clear") { commit("", ""); return close(true); }
    if (act === "done") close(true);
  });

  // Keyboard: arrows move between days, Page Up / Down change month, Escape closes.
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return close(true); }
    const day = e.target.closest?.(".dtp-day");
    if (!day) return;
    const k = day.dataset.k;
    const d = fromKey(k);
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target = null;
    if (e.key in steps) target = addDays(d, steps[e.key]);
    else if (e.key === "PageUp") target = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
    else if (e.key === "PageDown") target = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    else if (e.key === "Home") target = addDays(d, -d.getDay());
    else if (e.key === "End") target = addDays(d, 6 - d.getDay());
    if (!target) return;
    e.preventDefault();
    focusKey = keyOf(target);
    view = target;
    redraw(`.dtp-day[data-k="${focusKey}"]`);
  });

  paintTrigger();
  syncHidden();
}

// Turn the date, time and date-and-time inputs under `root` into the app's picker (computers only).
export function enhancePickers(root = document) {
  if (!IS_COMPUTER) return;
  root.querySelectorAll('input[type="datetime-local"], input[type="date"], input[type="time"]').forEach(enhance);
}
