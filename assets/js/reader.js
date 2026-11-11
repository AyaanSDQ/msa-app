import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js?v=13";
import {
  TYPE_META,
  typeBanner,
  escapeHtml,
  formatTime,
  formatEventDate,
  formatDateHeading,
  isSameLocalDay,
  localDateKey,
  effectiveTime,
  bucketOf,
  formatRelative,
  cancelledBanner,
  roomLabel,
  priorityOf,
  isEventPost,
  badgesHtml,
  dateTileHtml,
  emptyCardHtml,
  animateRemove,
} from "./shared.js?v=25";
import { expandSeries, nextActive, describeRule, parseKey, addDays, startOfDay } from "./recurrence.js?v=2";

const PAGE_SIZE = 20;
const heroEl = document.getElementById("hero");
const todayEl = document.getElementById("today-posts");
const todayCountEl = document.getElementById("today-count");
const historyEl = document.getElementById("history");
const todaySection = document.getElementById("today-section");
const upcomingEl = document.getElementById("upcoming-posts");
const upcomingCountEl = document.getElementById("upcoming-count");
const upcomingSection = document.getElementById("upcoming-section");
const historySection = document.getElementById("history-section");
const loadMoreWrap = document.getElementById("load-more-wrap");
const loadMoreBtn = document.getElementById("load-more");
const skeletonEl = document.getElementById("skeleton");
const pageEl = document.getElementById("page");
const newUpdatePill = document.getElementById("new-update-pill");
const newUpdatePillBtn = document.getElementById("new-update-pill-btn");

// Posts are placed by the time set on them (event_time), falling back to when
// they were posted for untimed ones. History pages through two sources (timed
// and untimed) that are merged by that effective time, so each keeps its own
// offset.
let timedOffset = 0;
let untimedOffset = 0;
let historyCount = 0; // history cards currently on screen
let historyDone = false;

// Today's active-post set, kept live so Realtime events can recompute the
// hero (pickHero needs the whole day's set, not just one changed row).
let todayRows = [];
let upcomingRows = [];
// Pinned posts (any date, any number) sit at the top as hero cards and are
// kept out of every other list.
let pinnedRows = [];
// Cancelled posts (pinned or not) all sit above everything else in their own
// "cancelled hero" cards and are kept out of every other list.
let cancelledRows = [];
let hasDeferredTodayUpdate = false;

// Repeating posts: one row each in `updates`. Their occurrences are worked out
// here (recurrence.js) and dropped into the same sets as ordinary posts, tagged
// is_occurrence, so the rest of the page treats them like any other post.
let seriesRows = [];
let seriesReady = Promise.resolve();
// The lower edge of the history shown so far, so each page of "Earlier" also
// picks up the repeating posts that fall in the stretch it covers.
let historyUpper = null;
const HISTORY_FLOOR_DAYS = 365;

// Realtime events can arrive before the initial fetch finishes; buffer them
// and replay after so nothing is lost and the empty state never shows stale.
let initialFetchDone = false;
let preInitEvents = [];

init();

async function init() {
  setupRealtime();

  const now = new Date();
  seriesReady = fetchSeries().then((rows) => { seriesRows = rows; });
  const [{ today, upcoming }, historyRows, pinned, cancelled] = await Promise.all([fetchTodayAndUpcoming(now), fetchHistoryPage(now), fetchPinned(), fetchCancelled(), seriesReady]);
  todayRows = today;
  upcomingRows = upcoming;
  pinnedRows = pinned;
  cancelledRows = cancelled;
  applySeries(now);

  renderHistoryBatch(historyRows);
  renderToday(now);
  updateLoadMoreVisibility();

  skeletonEl.hidden = true;
  pageEl.hidden = false;

  initialFetchDone = true;
  const buffered = preInitEvents;
  preInitEvents = [];
  buffered.forEach(handleRealtimeEvent);

  setInterval(refreshRelativeTimestamps, 60_000);
  wireNewUpdatePill();

  loadMoreBtn.addEventListener("click", handleLoadMore);

  maybeScrollToAnchor();
}

// Exec meetings are hidden from readers by RLS; the filter also keeps them
// out when an exec views this page while signed in (the exec "View" tab).
function baseQuery() {
  return supabase.from("updates").select("*").neq("status", "deleted").neq("type", "exec_meeting");
}

function dayBounds(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Today = timed posts happening today, plus untimed posts made today.
// Upcoming = timed posts on a later day.
async function fetchTodayAndUpcoming(now) {
  const { start, end } = dayBounds(now);
  const [todayRes, upcomingRes] = await Promise.all([
    baseQuery().or(`and(event_time.gte.${start},event_time.lt.${end}),and(event_time.is.null,created_at.gte.${start},created_at.lt.${end})`),
    baseQuery().gte("event_time", end).order("event_time", { ascending: true }).limit(50),
  ]);
  if (todayRes.error) console.error("Failed to load today's updates", todayRes.error);
  if (upcomingRes.error) console.error("Failed to load upcoming updates", upcomingRes.error);
  const regular = (r) => !r.pinned && r.status !== "cancelled" && !r.recurrence;
  return { today: (todayRes.data || []).filter(regular), upcoming: (upcomingRes.data || []).filter(regular) };
}

// Every active pinned post, whatever its date. (A cancelled pinned post is
// shown as a cancelled card instead.)
async function fetchPinned() {
  const { data, error } = await baseQuery().eq("pinned", true);
  if (error) console.error("Failed to load pinned updates", error);
  return sortPinned((data || []).filter((r) => r.status === "active" && !r.recurrence));
}

// Every cancelled post, whatever its date or pin state.
async function fetchCancelled() {
  const { data, error } = await baseQuery().eq("status", "cancelled");
  if (error) console.error("Failed to load cancelled updates", error);
  return sortCancelled((data || []).filter((r) => !r.recurrence));
}

// Cancellations still ahead come first (soonest first), then past ones (most
// recent first).
function sortCancelled(rows) {
  const now = Date.now();
  const t = (r) => new Date(effectiveTime(r)).getTime();
  const ahead = rows.filter((r) => t(r) >= now).sort((a, b) => t(a) - t(b));
  const past = rows.filter((r) => t(r) < now).sort((a, b) => t(b) - t(a));
  return [...ahead, ...past];
}

function sortPinned(rows) {
  return [...rows].sort((a, b) => postWeight(b) - postWeight(a) || new Date(b.created_at) - new Date(a.created_at));
}

// ── Repeating posts ─────────────────────────────────────────────────────

async function fetchSeries() {
  const { data, error } = await supabase
    .from("updates")
    .select("*")
    .not("recurrence", "is", null)
    .neq("status", "deleted")
    .neq("type", "exec_meeting");
  if (error) console.error("Failed to load repeating posts", error);
  return data || [];
}

// Where each series puts its occurrences: today's (and the next one) in the
// lists, cancelled ones in the cancelled cards, and a pinned series as one
// pinned card (today's occurrence, otherwise the next).
function seriesBuckets(now) {
  const today = startOfDay(now);
  const out = { today: [], upcoming: [], pinned: [], cancelled: [] };
  for (const row of seriesRows) {
    const rule = row.recurrence;
    if (!rule || row.status === "deleted") continue;
    for (const o of expandSeries(row, parseKey(rule.start), addDays(today, 180))) if (o.status === "cancelled") out.cancelled.push(o);
    const todays = expandSeries(row, today, today).find((o) => o.status === "active");
    const next = nextActive(row, addDays(today, 1));
    if (row.pinned) {
      const featured = todays || next;
      if (featured) out.pinned.push(featured);
      continue;
    }
    if (todays) out.today.push(todays);
    if (next) out.upcoming.push(next);
  }
  return out;
}

// Replace every occurrence in the page's sets with a fresh set (no rendering).
function applySeries(now) {
  const own = (r) => !r.is_occurrence;
  const b = seriesBuckets(now);
  todayRows = [...todayRows.filter(own), ...b.today];
  upcomingRows = [...upcomingRows.filter(own), ...b.upcoming];
  pinnedRows = [...pinnedRows.filter(own), ...b.pinned];
  cancelledRows = [...cancelledRows.filter(own), ...b.cancelled];
}

function historyFloor(now) {
  const today = startOfDay(now);
  let floor = today;
  for (const r of seriesRows) {
    if (r.pinned || !r.recurrence) continue;
    const start = parseKey(r.recurrence.start);
    if (start < floor) floor = start;
  }
  const limit = addDays(today, -HISTORY_FLOOR_DAYS);
  return floor < limit ? limit : floor;
}

// Past occurrences with lower <= time < upper.
function pastOccurrences(lower, upper) {
  const out = [];
  for (const row of seriesRows) {
    if (row.pinned || !row.recurrence) continue;
    for (const o of expandSeries(row, startOfDay(lower), startOfDay(upper))) {
      const t = new Date(o.event_time);
      if (o.status === "active" && t >= lower && t < upper) out.push(o);
    }
  }
  return out;
}

function recMark(update) {
  if (!update.is_occurrence) return "";
  const rule = describeRule(update.recurrence);
  return `<span class="rec-mark" title="${escapeHtml(rule)}">${icon("i-repeat", { size: 12 })}${escapeHtml(rule.split(" · ")[0])}</span>`;
}

// One page of history (everything whose effective time is before today),
// newest first. Takes a page's worth from each source, merges them, and only
// advances each source's offset by how many rows were actually used.
async function fetchHistoryPage(now) {
  const { start } = dayBounds(now);
  const [timedRes, untimedRes] = await Promise.all([
    baseQuery().lt("event_time", start).order("event_time", { ascending: false }).range(timedOffset, timedOffset + PAGE_SIZE - 1),
    baseQuery().is("event_time", null).lt("created_at", start).order("created_at", { ascending: false }).range(untimedOffset, untimedOffset + PAGE_SIZE - 1),
  ]);
  if (timedRes.error || untimedRes.error) console.error("Failed to load history", timedRes.error || untimedRes.error);
  const timed = timedRes.data || [];
  const untimed = untimedRes.data || [];

  const page = [];
  let t = 0;
  let u = 0;
  while (page.length < PAGE_SIZE && (t < timed.length || u < untimed.length)) {
    const takeTimed = u >= untimed.length || (t < timed.length && new Date(effectiveTime(timed[t])) >= new Date(effectiveTime(untimed[u])));
    page.push(takeTimed ? timed[t++] : untimed[u++]);
  }
  timedOffset += t;
  untimedOffset += u;
  historyDone = page.length < PAGE_SIZE;

  // Repeating posts' past occurrences fill the stretch of time this page covers
  // (down to the oldest row on it, or all the way back on the last page).
  await seriesReady;
  const upper = historyUpper || startOfDay(now);
  const lower = historyDone ? historyFloor(now) : new Date(effectiveTime(page[page.length - 1]));
  historyUpper = lower;
  const past = pastOccurrences(lower, upper);

  // Pinned and cancelled posts live at the top; they are skipped here but still
  // counted in the offsets above, so paging stays stable.
  return [...page.filter((r) => !r.pinned && r.status !== "cancelled" && !r.recurrence), ...past].sort((a, b) => new Date(effectiveTime(b)) - new Date(effectiveTime(a)) || tiebreak(a, b));
}

async function handleLoadMore() {
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = "Loading…";
  const rows = await fetchHistoryPage(new Date());
  renderHistoryBatch(rows, { append: true });
  updateLoadMoreVisibility();
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = "Load more";
}

function updateLoadMoreVisibility() {
  loadMoreWrap.hidden = historyDone;
}

// Post types that normally qualify as the featured "today" card (besides Important/Urgent posts).
const HERO_TYPES = new Set(["prayer"]);

// ── Hero selection ──────────────────────────────────────────────────────
// "Today" means the time set on the post is today (untimed posts: posted
// today). Among today's active prayers (and Important/Urgent posts): prefer the soonest still-upcoming event_time
// ("up next"); if everything scheduled today has already passed, fall back
// to whichever happened most recently; if nothing has a time at all, fall
// back to the most recently posted. Cancelled posts never become the hero
// (spec §12) but still render in "today's other posts" with their badge.
// By default only prayers, or posts flagged Important/Urgent, can be the featured
// card; social events and ordinary announcements are listed under "More today".
// With anyType (the page would otherwise have no hero card at all) any active post
// from today can step in.
function pickHero(todayRows, now, anyType = false) {
  const eligible = todayRows.filter((r) => r.status === "active" && (anyType || HERO_TYPES.has(r.type) || postWeight(r) > 0));
  if (eligible.length === 0) return null;

  // High-priority posts take the featured spot (pinned posts are shown above).
  const flagged = eligible.filter((r) => postWeight(r) > 0).sort((a, b) => postWeight(b) - postWeight(a) || new Date(b.created_at) - new Date(a.created_at));
  if (flagged.length) return flagged[0];

  const withTime = eligible.filter((r) => r.event_time);
  const upcoming = withTime
    .filter((r) => new Date(r.event_time) >= now)
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time) || tiebreak(a, b));
  if (upcoming.length) return upcoming[0];

  const past = withTime.sort((a, b) => new Date(b.event_time) - new Date(a.event_time) || tiebreak(a, b));
  if (past.length) return past[0];

  const byCreated = [...eligible].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return byCreated[0];
}

// Posts with the same effective time: events (prayer/social) come before
// announcements, then whichever was posted most recently.
function tiebreak(a, b) {
  const rank = (r) => (r.type === "announcement" ? 1 : 0);
  return rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at);
}

function postWeight(r) {
  return priorityOf(r) === "urgent" ? 3 : priorityOf(r) === "important" ? 2 : 0;
}

function renderToday(now) {
  // The soonest post of any type only steps in when nothing else would be a hero
  // card (no pinned, no cancelled, no prayer or flagged post), so there is always
  // at least one when anything is happening today.
  let hero = pickHero(todayRows, now);
  if (!hero && pinnedRows.length === 0 && cancelledRows.length === 0) hero = pickHero(todayRows, now, true);
  const rest = todayRows
    .filter((r) => r !== hero)
    .sort((a, b) => postWeight(b) - postWeight(a) || new Date(effectiveTime(a)) - new Date(effectiveTime(b)) || tiebreak(a, b));

  heroEl.innerHTML =
    sortCancelled(cancelledRows).map(cancelHeroHtml).join("") +
    sortPinned(pinnedRows).map(heroCardHtml).join("") +
    (hero ? heroCardHtml(hero) : "");
  todayCountEl.textContent = String(rest.length);
  todayEl.innerHTML = rest.map((r) => listCardHtml(r)).join("");
  todaySection.hidden = rest.length === 0;

  const upcoming = [...upcomingRows].sort((a, b) => new Date(a.event_time) - new Date(b.event_time) || tiebreak(a, b));
  upcomingCountEl.textContent = String(upcoming.length);
  upcomingEl.innerHTML = upcoming.map((r) => listCardHtml(r)).join("");
  upcomingSection.hidden = upcoming.length === 0;
  syncEmptyState();
}

// Never two empty states at once, and a section with nothing in it is hidden.
function syncEmptyState() {
  const hasHero = !!heroEl.querySelector(".hero-card");
  const hasToday = todayEl.children.length > 0;
  const hasAnything = hasHero || hasToday || upcomingEl.children.length > 0 || historyCount > 0;

  if (!hasHero) {
    if (!hasAnything) {
      heroEl.innerHTML = emptyCardHtml("today", "Welcome to Ummah", "Announcements, events and updates from the MSA show up here the moment they're posted.", { cta: { href: "calendar.html", label: "Open the calendar" } });
    } else if (!hasToday) {
      heroEl.innerHTML = emptyCardHtml("today", "Nothing new today", "You're all caught up. See what's coming up on the calendar.", { compact: true, cta: { href: "calendar.html", label: "Open the calendar" } });
    }
  }
  historySection.hidden = historyCount === 0;
}

function renderHistoryBatch(rows, { append = false } = {}) {
  if (!append) { historyEl.innerHTML = ""; historyCount = 0; delete historyEl.dataset.lastGroupKey; }
  if (rows.length === 0) {
    historySection.hidden = historyCount === 0;
    return;
  }
  historyCount += rows.length;
  historySection.hidden = false;

  let currentGroup = null;
  let groupWrap = null;
  const lastKey = historyEl.dataset.lastGroupKey || null;
  let activeKey = lastKey;

  for (const row of rows) {
    const key = localDateKey(effectiveTime(row));
    if (key !== activeKey) {
      const heading = document.createElement("div");
      heading.className = "date-heading";
      heading.textContent = formatDateHeading(new Date(effectiveTime(row)));
      historyEl.appendChild(heading);

      groupWrap = document.createElement("div");
      groupWrap.className = "hist-group";
      historyEl.appendChild(groupWrap);
      activeKey = key;
    }
    groupWrap.insertAdjacentHTML("beforeend", histCardHtml(row));
  }
  historyEl.dataset.lastGroupKey = activeKey || "";
}

// ── Card templates ──────────────────────────────────────────────────────

function heroCardHtml(update) {
  const meta = TYPE_META[update.type];
  const upcoming = update.event_time && new Date(update.event_time) > new Date();
  const status = !badgesHtml(update) && upcoming ? `<span class="badge badge-soon">Up next</span>` : "";
  const badges = `<div class="hero-badges">${badgesHtml(update)}${status}</div>`;
  const media = `<div class="hero-media is-pattern" data-type="${update.type}"><span class="hero-media-icon">${icon(meta.iconId, { size: 24 })}</span>${badges}</div>`;
  return `
  <article class="hero-card hero-v2" style="--c:var(--type-${update.type}-hero)" data-update-id="${update.id}">
    ${media}
    <div class="hero-body">
      <div class="hero-eyebrow"><span class="hero-type"><i></i>${meta.label}</span>${recMark(update)}</div>
      <h2 class="hero-title">${escapeHtml(update.title)}</h2>
      ${chipsHtml(update)}
      ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="hero-footer" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)}</span>
      </div>
    </div>
  </article>`;
}

// A cancelled post, whatever its pin state. It is the normal hero card (same
// banner colour, type, title, chips) with two changes: a red tape across the top
// saying "Cancelled - reason", and a ban icon in the banner. Always shown above every other card.
function cancelHeroHtml(update) {
  const meta = TYPE_META[update.type];
  const badges = `<div class="hero-badges">${badgesHtml(update)}</div>`;
  const tape = `<div class="cancel-tape">${icon("i-ban", { size: 15 })}<p><b>Cancelled</b>${update.cancel_reason ? ` <span>-</span> ${escapeHtml(update.cancel_reason)}` : ""}</p></div>`;
  const media = `<div class="hero-media is-pattern" data-type="${update.type}"><span class="hero-media-icon">${icon("i-ban", { size: 24 })}</span>${badges}</div>`;
  return `
  <article class="hero-card hero-v2 is-cancelled" style="--c:var(--type-${update.type}-hero)" data-update-id="${update.id}">
    ${tape}
    ${media}
    <div class="hero-body">
      <div class="hero-eyebrow"><span class="hero-type"><i></i>${meta.label}</span>${recMark(update)}</div>
      <h2 class="hero-title">${escapeHtml(update.title)}</h2>
      ${chipsHtml(update)}
      ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="hero-footer" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)}</span>
      </div>
    </div>
  </article>`;
}

function chipsHtml(update) {
  const chips = [];
  if (update.event_time) {
    chips.push(`<span class="chip">${icon("i-calendar", { size: 14 })}${formatEventDate(update.event_time)}</span>`);
    chips.push(`<span class="chip">${icon("i-clock", { size: 14 })}${formatTime(update.event_time)}</span>`);
  }
  if (update.location) chips.push(`<span class="chip">${icon("i-pin", { size: 14 })}${escapeHtml(roomLabel(update.location))}</span>`);
  return chips.length ? `<div class="hero-chips">${chips.join("")}</div>` : "";
}

// Standard announcement card, or an event card (date tile) for dated events.
function listCardHtml(update) {
  const meta = TYPE_META[update.type];
  const event = isEventPost(update);
  const pr = priorityOf(update);
  const lead = event
    ? dateTileHtml(update.event_time, update.type)
    : `<div class="list-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 22 })}</div>`;
  const badges = badgesHtml(update);
  const body = `
    ${lead}
    <div class="list-body">
      <div class="list-kicker" style="color:var(--type-${update.type}-icon)"><i></i>${meta.label}${recMark(update)}${badges ? `<span class="kicker-badges">${badges}</span>` : ""}</div>
      <div class="list-title">${escapeHtml(update.title)}</div>
      <div class="list-meta">${metaLine(update, { skipDate: event })}</div>
      ${update.body ? `<p class="list-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="list-updated" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)}</span>
      </div>
    </div>`;
  const cls = `list-card ${event ? "card-event" : "card-announcement"}${pr !== "normal" ? ` is-${pr}` : ""}`;
  if (update.status === "cancelled") {
    return `<div class="hist-card" data-update-id="${update.id}" style="background:var(--type-${update.type}-list)">
      ${cancelledBanner(update.cancel_reason)}
      <div class="${cls}" style="box-shadow:none;margin-bottom:0">${body}</div>
    </div>`;
  }
  return `<div class="${cls}" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${body}</div>`;
}

function histCardHtml(update) {
  const meta = TYPE_META[update.type];
  const row = `
    <div class="hist-row">
      <div class="hist-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 16 })}</div>
      <div class="list-body">
        <div class="hist-title">${escapeHtml(update.title)}</div>
        <div class="hist-meta">${metaLine(update)}</div>
      </div>
    </div>`;
  if (update.status === "cancelled") {
    return `<div class="hist-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${cancelledBanner(update.cancel_reason)}${row}</div>`;
  }
  return `<div class="hist-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${row}</div>`;
}

function metaLine(update, { skipDate = false } = {}) {
  const parts = [];
  if (update.event_time) {
    if (!skipDate) parts.push(formatEventDate(update.event_time));
    parts.push(formatTime(update.event_time));
  }
  if (update.location) parts.push(escapeHtml(roomLabel(update.location)));
  return parts.join(" · ");
}

function refreshRelativeTimestamps() {
  document.querySelectorAll("[data-updated-at]").forEach((el) => {
    const ts = el.dataset.updatedAt;
    const textEl = el.querySelector(".updated-text");
    if (!textEl) return;
    const rest = textEl.textContent.split("·").slice(1).join("·").trim();
    textEl.textContent = rest ? `${formatRelative(ts)} · ${rest}` : formatRelative(ts);
  });
}

function maybeScrollToAnchor() {
  if (!location.hash) return;
  const id = location.hash.replace("#post-", "");
  const el = document.querySelector(`[data-update-id="${id}"]`) || document.querySelector(`[data-update-id^="${id}@"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── Realtime ─────────────────────────────────────────────────────────────
// Cancelled/deleted transitions apply immediately wherever the affected
// card is (they're targeted edits to one existing card, not new content
// pushed in above the reader). New active arrivals are the one case that
// can reflow content above whatever the reader is currently scrolled past,
// so those get deferred behind the "New update" pill unless already near
// the top.

function setupRealtime() {
  supabase
    .channel("reader-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "updates" }, (payload) => {
      if (!initialFetchDone) {
        preInitEvents.push(payload);
        return;
      }
      handleRealtimeEvent(payload);
    })
    .subscribe();
}

function handleRealtimeEvent(payload) {
  const row = payload.new;
  if (!row || row.type === "exec_meeting") return; // RLS already blocks this for anon; defensive only
  if (row.recurrence || seriesRows.some((s) => s.id === row.id)) return handleSeriesEvent(row);
  if (row.status === "deleted") handleDeleted(row.id);
  else if (row.status === "cancelled") handleCancelled(row);
  else if (row.pinned) handlePinned(row);
  else if (row.status === "active") handleActiveArrival(row);
}

// A repeating post was created, edited (a cancelled date, a new rule) or deleted:
// rebuild all of its occurrences. A deleted series slides out first.
function handleSeriesEvent(row) {
  const now = new Date();
  const deleted = row.status === "deleted" || !row.recurrence;
  seriesRows = seriesRows.filter((s) => s.id !== row.id);
  if (!deleted) seriesRows.push(row);

  const apply = () => {
    applySeries(now);
    showTopChange(now);
    reloadHistory();
  };

  const gone = deleted ? [...document.querySelectorAll(`[data-update-id^="${row.id}@"]`)] : [];
  if (!gone.length) return apply();
  applySeries(now); // drop the data now so nothing re-renders the cards mid-animation
  let left = gone.length;
  gone.forEach((el) => animateRemove(el, () => { if (--left === 0) apply(); }));
}

function removeFromSets(id) {
  todayRows = todayRows.filter((r) => r.id !== id);
  upcomingRows = upcomingRows.filter((r) => r.id !== id);
  pinnedRows = pinnedRows.filter((r) => r.id !== id);
  cancelledRows = cancelledRows.filter((r) => r.id !== id);
}

// A post that was in the Earlier list has just been pinned or cancelled: take its card (and
// its date heading, if it was the only one that day) out of that list.
function removeHistoryCard(id) {
  const el = historyEl.querySelector(`[data-update-id="${id}"]`);
  if (!el) return;
  const group = el.closest(".hist-group");
  el.remove();
  if (group && !group.children.length) {
    const heading = group.previousElementSibling;
    if (heading?.classList.contains("date-heading")) heading.remove();
    group.remove();
  }
  historyCount = historyEl.querySelectorAll(".hist-card").length;
}

// Start the Earlier list over (used when an unpinned post needs to slot back
// into it).
async function reloadHistory() {
  timedOffset = 0;
  untimedOffset = 0;
  historyUpper = null;
  historyDone = false;
  renderHistoryBatch(await fetchHistoryPage(new Date()));
  updateLoadMoreVisibility();
  syncEmptyState();
}

// Pinned posts: shown at the top. A change to a post that is already pinned
// (edited notes) updates its card in place; a newly pinned post moves up from
// wherever it was.
function handlePinned(row) {
  const now = new Date();
  const el = heroEl.querySelector(`[data-update-id="${row.id}"]`);
  if (el && pinnedRows.some((r) => r.id === row.id)) {
    pinnedRows = pinnedRows.map((r) => (r.id === row.id ? row : r));
    el.outerHTML = heroCardHtml(row);
    return;
  }

  removeFromSets(row.id);
  removeHistoryCard(row.id);
  pinnedRows.push(row);
  showTopChange(now);
}

// Cancelled posts: pulled out of whatever list they were in and shown as a
// cancelled card at the very top, pinned or not.
function handleCancelled(row) {
  const now = new Date();
  const el = heroEl.querySelector(`[data-update-id="${row.id}"]`);
  if (el && cancelledRows.some((r) => r.id === row.id)) {
    cancelledRows = cancelledRows.map((r) => (r.id === row.id ? row : r));
    el.outerHTML = cancelHeroHtml(row);
    return;
  }

  removeFromSets(row.id);
  removeHistoryCard(row.id);
  cancelledRows.push(row);
  showTopChange(now);
}

// Changes at the top of the page reflow everything below, so they wait behind
// the "New update" pill unless the reader is already near the top.
function showTopChange(now) {
  if (isScrolledNearTop()) {
    renderToday(now);
  } else {
    hasDeferredTodayUpdate = true;
    newUpdatePill.hidden = false;
  }
}

function handleActiveArrival(row) {
  const now = new Date();
  const bucket = bucketOf(row, now);
  const wasOnTop = pinnedRows.some((r) => r.id === row.id) || cancelledRows.some((r) => r.id === row.id);

  removeFromSets(row.id);
  if (bucket === "history") {
    if (wasOnTop) {
      // just unpinned or restored: back into the Earlier list at its place
      renderToday(now);
      reloadHistory();
      return;
    }
    const el = document.querySelector(`[data-update-id="${row.id}"]`);
    if (el && historyEl.contains(el)) el.outerHTML = histCardHtml(row);
    return;
  }

  (bucket === "today" ? todayRows : upcomingRows).push(row);

  if (wasOnTop || isScrolledNearTop()) {
    renderToday(now);
  } else {
    hasDeferredTodayUpdate = true;
    newUpdatePill.hidden = false;
  }
}

function handleDeleted(id) {
  const el = document.querySelector(`[data-update-id="${id}"]`);
  const inSets = [todayRows, upcomingRows, pinnedRows, cancelledRows].some((list) => list.some((r) => r.id === id));

  if (!el) {
    removeFromSets(id);
    return;
  }

  animateRemove(el, () => {
    removeFromSets(id);
    if (inSets) renderToday(new Date());
    historyCount = historyEl.querySelectorAll(".hist-card").length;
    syncEmptyState();
  });
}

function isScrolledNearTop() {
  return (document.documentElement.scrollTop || document.body.scrollTop) <= 40;
}

function wireNewUpdatePill() {
  newUpdatePillBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    applyDeferredToday();
  });
  window.addEventListener("scroll", () => {
    if (hasDeferredTodayUpdate && isScrolledNearTop()) applyDeferredToday();
  });
}

function applyDeferredToday() {
  if (!hasDeferredTodayUpdate) return;
  hasDeferredTodayUpdate = false;
  newUpdatePill.hidden = true;
  renderToday(new Date());
}
