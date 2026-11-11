// Recurring posts.
//
// A repeating post is ONE row in `updates`. Its `recurrence` column holds the rule
// and `occurrence_overrides` holds the few dates an admin changed. Individual
// occurrences are never stored: they are worked out here, in the browser, for
// whatever dates a page needs.
//
// recurrence = {
//   v: 1,
//   freq: "daily" | "weekly",
//   interval: 1,                       // every N days / weeks (the form always uses 1)
//   weekdays: [1, 3, 5],               // weekly: 0 = Sunday .. 6 = Saturday
//   start: "2026-11-17",               // first date (local)
//   time: "19:00",                     // local time of day
//   ends: { type: "never" } | { type: "on", date: "2026-12-19" } | { type: "count", count: 10 },
//   changes: [{ from: "2026-12-01", title?, location?, body?, time? }]   // "this and all future" edits
// }
//
// occurrence_overrides = { "2026-11-24": { status: "cancelled" | "deleted", cancel_reason?, title?, location?, body?, time? } }
//
// All dates are local calendar dates written "YYYY-MM-DD"; times are local "HH:MM".

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_STEPS = 20000; // hard stop for runaway rules

const pad = (n) => String(n).padStart(2, "0");

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Every date the rule produces, oldest first, forever (callers stop reading).
function* candidates(rule) {
  const start = parseKey(rule.start);
  const interval = Math.max(1, Number(rule.interval) || 1);

  if (rule.freq === "weekly") {
    const days = [...new Set(rule.weekdays?.length ? rule.weekdays : [start.getDay()])].sort((a, b) => a - b);
    const anchor = addDays(start, -start.getDay());
    for (let w = 0; ; w += 1) {
      const base = addDays(anchor, w * 7 * interval);
      for (const wd of days) {
        const d = addDays(base, wd);
        if (d >= start) yield d;
      }
    }
  } else {
    for (let k = 0; ; k += 1) yield addDays(start, k * interval);
  }
}

// Occurrence dates between two dates, inclusive.
export function occurrenceDates(rule, from, to) {
  if (!rule || !rule.start) return [];
  const lo = startOfDay(from);
  const hi = startOfDay(to);
  const endsOn = rule.ends?.type === "on" ? parseKey(rule.ends.date) : null;
  const maxCount = rule.ends?.type === "count" ? Number(rule.ends.count) : Infinity;
  const out = [];
  let n = 0;
  let steps = 0;
  for (const d of candidates(rule)) {
    if (++steps > MAX_STEPS || n >= maxCount || d > hi || (endsOn && d > endsOn)) break;
    n += 1;
    if (d >= lo) out.push(d);
  }
  return out;
}

export function firstOccurrence(rule) {
  const [d] = occurrenceDates(rule, parseKey(rule.start), addDays(parseKey(rule.start), 4000));
  return d || null;
}

// What an occurrence looks like once the series' "from this date on" changes and
// any single-date override are applied.
export function effectiveFields(row, dateStr) {
  const rule = row.recurrence;
  const f = { title: row.title, location: row.location, body: row.body, time: rule.time };
  for (const c of rule.changes || []) {
    if (c.from <= dateStr) for (const k of ["title", "location", "body", "time"]) if (k in c) f[k] = c[k];
  }
  const ov = (row.occurrence_overrides || {})[dateStr] || {};
  for (const k of ["title", "location", "body", "time"]) if (k in ov) f[k] = ov[k];
  return f;
}

// The occurrences of a series between two dates, as post-shaped objects. Their id
// is "<series id>@<date>" so every occurrence is unique on a page.
export function expandSeries(row, from, to) {
  const rule = row.recurrence;
  if (!rule) return [];
  const overrides = row.occurrence_overrides || {};
  const out = [];
  for (const d of occurrenceDates(rule, from, to)) {
    const key = dateKey(d);
    const ov = overrides[key] || {};
    if (ov.status === "deleted") continue;
    const f = effectiveFields(row, key);
    const [hh, mm] = (f.time || "00:00").split(":").map(Number);
    const cancelled = ov.status === "cancelled";
    out.push({
      ...row,
      id: `${row.id}@${key}`,
      series_id: row.id,
      occurrence_date: key,
      is_occurrence: true,
      title: f.title,
      location: f.location,
      body: f.body,
      event_time: new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0).toISOString(),
      status: cancelled ? "cancelled" : "active",
      cancel_reason: cancelled ? ov.cancel_reason || null : null,
    });
  }
  return out;
}

// The next occurrence on or after `from` that is not cancelled.
export function nextActive(row, from, { days = 400 } = {}) {
  return expandSeries(row, from, addDays(from, days)).find((o) => o.status === "active") || null;
}

export function splitOccurrenceId(id) {
  const i = String(id).indexOf("@");
  return i === -1 ? { seriesId: id, date: null } : { seriesId: id.slice(0, i), date: id.slice(i + 1) };
}

// ── Describing a rule ───────────────────────────────────────────────────

function dayList(days) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.join() === "0,6") return "Weekends";
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

function shortDate(key) {
  return parseKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "Daily", "Weekly · Mon, Wed", "Every 2 weeks · Fri"
export function describeRule(rule) {
  if (!rule) return "";
  const n = Math.max(1, Number(rule.interval) || 1);
  if (rule.freq === "weekly") {
    const days = rule.weekdays?.length ? rule.weekdays : [parseKey(rule.start).getDay()];
    return `${n === 1 ? "Weekly" : `Every ${n} weeks`} · ${dayList(days)}`;
  }
  return n === 1 ? "Daily" : `Every ${n} days`;
}

export function describeEnds(rule) {
  if (rule?.ends?.type === "on") return `Ends ${shortDate(rule.ends.date)}`;
  if (rule?.ends?.type === "count") return `${rule.ends.count} times`;
  return "";
}

// One line for the form, e.g. "Weekly · Mon, Wed from Nov 17 · Ends Dec 19"
export function summaryLine(rule) {
  if (!rule) return "";
  return [describeRule(rule), `from ${shortDate(rule.start)}`, describeEnds(rule)].filter(Boolean).join(" · ");
}

// ── Building and editing rules ──────────────────────────────────────────

// Returns an error message, or null when the rule is usable.
export function validateRule(rule) {
  if (!rule) return null;
  if (!rule.start) return "Pick a start date.";
  if (!/^\d{2}:\d{2}$/.test(rule.time || "")) return "Add a time for a repeating post.";
  const n = Number(rule.interval);
  if (!Number.isInteger(n) || n < 1 || n > 99) return "Repeat interval must be between 1 and 99.";
  if (rule.freq === "weekly" && !(rule.weekdays || []).length) return "Pick at least one day of the week.";
  if (rule.ends?.type === "on") {
    if (!rule.ends.date) return "Pick an end date.";
    if (rule.ends.date < rule.start) return "The end date can't be before the start date.";
  }
  if (rule.ends?.type === "count") {
    const c = Number(rule.ends.count);
    if (!Number.isInteger(c) || c < 1 || c > 999) return "Number of times must be between 1 and 999.";
  }
  if (!firstOccurrence(rule)) return "That rule never produces a date. Check the days and dates.";
  return null;
}

// The series stops the day before `dateStr` (used by "this and all future").
export function endBefore(rule, dateStr) {
  const last = dateKey(addDays(parseKey(dateStr), -1));
  const current = rule.ends?.type === "on" ? rule.ends.date : null;
  return { ...rule, ends: { type: "on", date: current && current < last ? current : last } };
}

// Record a "from this date on" change (merging with one already on that date).
export function withChange(rule, from, fields) {
  const changes = [...(rule.changes || [])];
  const i = changes.findIndex((c) => c.from === from);
  if (i >= 0) changes[i] = { ...changes[i], ...fields };
  else changes.push({ from, ...fields });
  changes.sort((a, b) => (a.from < b.from ? -1 : 1));
  return { ...rule, changes };
}

// Is this the very first date of the series?
export function isFirstOccurrence(rule, dateStr) {
  const first = firstOccurrence(rule);
  return !!first && dateKey(first) === dateStr;
}

export function overrideCount(row) {
  const ov = Object.keys(row.occurrence_overrides || {}).length;
  return ov + ((row.recurrence?.changes || []).length || 0);
}
