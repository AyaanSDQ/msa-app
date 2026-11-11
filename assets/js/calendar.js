import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js?v=12";
import { TYPE_META, escapeHtml, formatTime, roomLabel, emptyCardHtml } from "./shared.js?v=24";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const BARS_PER_DAY = 3; // colour bars shown in a day cell; the last one becomes "+N" when there are more
const GRID_SLOTS = 42; // 6 weeks x 7 days

const root = document.getElementById("calendar");
const today = new Date();

let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let view = "month"; // "month" | "agenda"
let slide = ""; // "next" | "prev": direction of the month change animation
let loading = true;
const cache = new Map(); // "YYYY-M" -> updates[]

const monthKey = (y, m) => `${y}-${m}`;
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sameDay = (a, b) => !!a && !!b && dayKey(a) === dayKey(b);

init();

async function init() {
  render();
  await loadMonth();
  supabase
    .channel("calendar-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "updates" }, () => {
      cache.clear();
      loadMonth();
    })
    .subscribe();
}

async function loadMonth() {
  const key = monthKey(viewYear, viewMonth);
  if (!cache.has(key)) {
    loading = true;
    render();
    const start = new Date(viewYear, viewMonth, 1);
    const end = new Date(viewYear, viewMonth + 1, 1);
    const { data, error } = await supabase
      .from("updates")
      .select("*")
      .not("event_time", "is", null)
      .neq("status", "deleted")
      .neq("type", "exec_meeting")
      .gte("event_time", start.toISOString())
      .lt("event_time", end.toISOString())
      .order("event_time", { ascending: true });
    if (error) console.error("Failed to load calendar", error);
    cache.set(key, data || []);
  }
  loading = false;
  render();
}

function eventsByDay() {
  const map = new Map();
  for (const u of cache.get(monthKey(viewYear, viewMonth)) || []) {
    const k = dayKey(new Date(u.event_time));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(u);
  }
  return map;
}

// One thin colour bar per event, in the colour of its type. Cancelled events
// are drawn as an outline so they read as "not happening" at a glance.
function barHtml(u) {
  const cancelled = u.status === "cancelled" ? " is-cancelled" : "";
  return `<span class="cal-bar${cancelled}" style="--c:var(--type-${u.type}-hero)"></span>`;
}

function barsHtml(events) {
  if (!events.length) return `<span class="cal-bars"></span>`;
  const over = events.length > BARS_PER_DAY;
  const shown = (over ? events.slice(0, BARS_PER_DAY - 1) : events).map(barHtml).join("");
  const more = over ? `<span class="cal-more">+${events.length - (BARS_PER_DAY - 1)}</span>` : "";
  return `<span class="cal-bars">${shown}${more}</span>`;
}

function render() {
  const byDay = eventsByDay();
  root.innerHTML = `
    ${headHtml()}
    ${view === "month" ? monthHtml(byDay) : agendaHtml(byDay)}
  `;
  if (slide) {
    root.querySelector(".cal-card")?.classList.add(`slide-${slide}`);
    slide = "";
  }
}

function headHtml() {
  const other = view === "month" ? "agenda" : "month";
  const viewIcon = view === "month" ? "i-list" : "i-calendar";
  const viewLabel = view === "month" ? "Show agenda" : "Show month";
  return `<div class="cal-head">
      <div class="cal-month"><span class="cal-year">${viewYear}</span><span class="cal-name">${MONTHS[viewMonth]}</span></div>
      <div class="cal-nav">
        <button type="button" class="btn cal-arrow cal-prev" data-cal-prev aria-label="Previous month">${icon("i-chev", { size: 16, stroke: 2.5 })}</button>
        <button type="button" class="btn cal-arrow cal-next" data-cal-next aria-label="Next month">${icon("i-chev", { size: 16, stroke: 2.5 })}</button>
        <button type="button" class="btn cal-view" data-view="${other}" aria-label="${viewLabel}">${icon(viewIcon, { size: 20, stroke: 2.3 })}</button>
      </div>
    </div>`;
}

function legendHtml() {
  return `<div class="cal-legend">${Object.entries(TYPE_META).map(([t, m]) => `<span><i style="background:var(--type-${t}-hero)"></i>${m.label}</span>`).join("")}</div>`;
}

function monthHtml(byDay) {
  const first = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Always 6 weeks (42 slots), with a faint dot under every slot including the
  // empty ones, so every month is the same height and the page never shifts.
  const pad = `<span class="cal-day cal-pad" aria-hidden="true"><span class="cal-num"></span><span class="cal-bars"></span></span>`;
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(pad);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(viewYear, viewMonth, day);
    const events = byDay.get(dayKey(date)) || [];
    const lead = events.find((u) => u.status !== "cancelled") || events[0];
    const tint = lead ? ` style="--tint:var(--type-${lead.type}-hero)"` : "";
    const cls = ["cal-day", sameDay(date, today) ? "today" : "", sameDay(date, selected) ? "selected" : "", events.length ? "has" : ""].filter(Boolean).join(" ");
    const label = `${MONTHS[viewMonth]} ${day}` + (events.length ? `, ${events.map((u) => `${u.title} at ${formatTime(u.event_time)}`).join("; ")}` : ", no events");
    cells.push(`<button type="button" class="${cls}"${tint} data-day="${day}" aria-label="${escapeHtml(label)}" ${sameDay(date, selected) ? 'aria-pressed="true"' : ""}><span class="cal-num">${day}</span>${barsHtml(events)}</button>`);
  }
  while (cells.length < GRID_SLOTS) cells.push(pad);

  return `
    <div class="cal-card">
      <div class="cal-grid ${loading ? "is-loading" : ""}">
        ${WEEKDAYS.map((d) => `<div class="cal-weekday">${d}</div>`).join("")}
        ${cells.join("")}
      </div>
      ${legendHtml()}
    </div>
    ${dayPanel(byDay)}`;
}

function dayPanel(byDay) {
  if (!selected) return monthPanel(byDay);
  const events = byDay.get(dayKey(selected)) || [];
  const title = selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const body = loading
    ? loadingMessage("Nothing planned")
    : events.length
      ? events.map(eventCard).join("")
      : `${emptyCardHtml("calendar", "Nothing planned", "", { compact: true })}${nextEventHint(byDay)}`;
  return `<section class="cal-panel">
    <div class="cal-panel-head">
      <div class="cal-panel-title">${escapeHtml(title)}</div>
      ${!loading && events.length ? `<span class="cal-count">${events.length} ${events.length === 1 ? "event" : "events"}</span>` : ""}
    </div>
    ${body}
  </section>`;
}

// Loading placeholder: the real empty-message card with its text made invisible
// (shimmer instead), so it is exactly as tall as the message that replaces it.
function loadingMessage(text) {
  return `<div class="cal-loading-msg" aria-hidden="true">${emptyCardHtml("calendar", text, "", { compact: true })}</div>`;
}

// Shown when no day is selected (e.g. after changing month): everything in the month.
function monthPanel(byDay) {
  const days = [...byDay.entries()]
    .map(([key, list]) => { const [y, m, d] = key.split("-").map(Number); return { date: new Date(y, m, d), list }; })
    .sort((a, b) => a.date - b.date);
  let body;
  if (loading) body = loadingMessage(`Nothing in ${MONTHS[viewMonth]} yet`);
  else if (!days.length) body = emptyCardHtml("calendar", `Nothing in ${MONTHS[viewMonth]} yet`, "", { compact: true });
  else body = days.map(({ date, list }) => {
    const label = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return `<div class="cal-panel-label">${escapeHtml(label)}</div>${list.map(eventCard).join("")}`;
  }).join("");
  return `<section class="cal-panel">
    <div class="cal-panel-head">
      <div class="cal-panel-title">${MONTHS[viewMonth]}</div>
    </div>
    ${body}
  </section>`;
}

// Every event this month, grouped by day, in time order.
function agendaHtml(byDay) {
  if (loading) return `<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div>`;
  const days = [...byDay.entries()]
    .map(([k, list]) => { const [y, m, d] = k.split("-").map(Number); return { date: new Date(y, m, d), list }; })
    .sort((a, b) => a.date - b.date);
  if (!days.length) {
    return `${legendHtml()}${emptyCardHtml("calendar", `Nothing in ${MONTHS[viewMonth]} yet`, "", { compact: true })}`;
  }
  return `${legendHtml()}${days.map(({ date, list }) => {
    const title = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    return `<div class="section-heading cal-panel-heading"><div class="label">${escapeHtml(title)}</div></div>${list.map(eventCard).join("")}`;
  }).join("")}`;
}

// When a day is empty, point to the next day this month that has something on.
function nextEventHint(byDay) {
  const sel = Date.UTC(selected.getFullYear(), selected.getMonth(), selected.getDate());
  let best = null;
  for (const [k, list] of byDay) {
    const [y, m, d] = k.split("-").map(Number);
    const t = Date.UTC(y, m, d);
    if (t > sel && (!best || t < best.t)) best = { t, y, m, d, list };
  }
  if (!best) return "";
  const label = new Date(best.y, best.m, best.d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `<button type="button" class="cal-next-hint" data-goto-day="${best.d}">Next: <strong>${label}</strong> · ${escapeHtml(best.list[0].title)}</button>`;
}

function eventCard(u) {
  const meta = TYPE_META[u.type];
  if (!meta) return "";
  const cancelled = u.status === "cancelled";
  return `<article class="cal-ev${cancelled ? " is-cancelled" : ""}" style="--c:var(--type-${u.type}-hero)">
    <div class="cal-ev-time">${escapeHtml(formatTime(u.event_time))}</div>
    <div class="cal-ev-body">
      <div class="cal-ev-kicker"><i></i>${meta.label}</div>
      <h3 class="cal-ev-title">${escapeHtml(u.title)}</h3>
      ${u.location ? `<div class="cal-ev-meta">${icon("i-pin", { size: 13 })}${escapeHtml(roomLabel(u.location))}</div>` : ""}
      ${u.body ? `<p class="cal-ev-notes">${escapeHtml(u.body)}</p>` : ""}
      ${cancelled ? `<div class="cal-ev-cancel">Cancelled${u.cancel_reason ? `: ${escapeHtml(u.cancel_reason)}` : ""}</div>` : ""}
    </div>
  </article>`;
}

function shiftMonth(delta) {
  slide = delta > 0 ? "next" : "prev";
  const d = new Date(viewYear, viewMonth + delta, 1);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  // current month: today is selected; any other month starts with no day selected
  selected = sameMonth(d, today) ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : null;
  loadMonth();
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

root.addEventListener("click", (e) => {
  const seg = e.target.closest("[data-view]");
  if (seg) {
    view = seg.dataset.view;
    return render();
  }
  if (e.target.closest("[data-cal-prev]")) return shiftMonth(-1);
  if (e.target.closest("[data-cal-next]")) return shiftMonth(1);
  const goto = e.target.closest("[data-goto-day]");
  if (goto) {
    selected = new Date(viewYear, viewMonth, Number(goto.dataset.gotoDay));
    return render();
  }
  const day = e.target.closest("[data-day]");
  if (day) {
    selected = new Date(viewYear, viewMonth, Number(day.dataset.day));
    render();
  }
});

// Swipe the month card left / right to change month (phones).
let touchX = null, touchY = null;
root.addEventListener("touchstart", (e) => {
  if (!e.target.closest(".cal-card")) { touchX = null; return; }
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}, { passive: true });
root.addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  touchX = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) shiftMonth(dx < 0 ? 1 : -1);
}, { passive: true });
