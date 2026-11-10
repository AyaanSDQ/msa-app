import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js?v=11";
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
  safeImageUrl,
  priorityOf,
  isEventPost,
  badgesHtml,
  dateTileHtml,
  emptyCardHtml,
} from "./shared.js?v=22";

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
let hasDeferredTodayUpdate = false;

// Realtime events can arrive before the initial fetch finishes; buffer them
// and replay after so nothing is lost and the empty state never shows stale.
let initialFetchDone = false;
let preInitEvents = [];

init();

async function init() {
  setupRealtime();

  const now = new Date();
  const [{ today, upcoming }, historyRows] = await Promise.all([fetchTodayAndUpcoming(now), fetchHistoryPage(now)]);
  todayRows = today;
  upcomingRows = upcoming;

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
  wireFeedbackDelegation();
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
  return { today: todayRes.data || [], upcoming: upcomingRes.data || [] };
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
  return page.sort((a, b) => new Date(effectiveTime(b)) - new Date(effectiveTime(a)) || tiebreak(a, b));
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

// ── Hero selection ──────────────────────────────────────────────────────
// "Today" means the time set on the post is today (untimed posts: posted
// today). Among today's active posts: prefer the soonest still-upcoming event_time
// ("up next"); if everything scheduled today has already passed, fall back
// to whichever happened most recently; if nothing has a time at all, fall
// back to the most recently posted. Cancelled posts never become the hero
// (spec §12) but still render in "today's other posts" with their badge.
function pickHero(todayRows, now) {
  const eligible = todayRows.filter((r) => r.status === "active");
  if (eligible.length === 0) return null;

  // Pinned and high-priority posts always take the featured spot.
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
  return (r.pinned ? 4 : 0) + (priorityOf(r) === "urgent" ? 3 : priorityOf(r) === "important" ? 2 : 0);
}

function renderToday(now) {
  const hero = pickHero(todayRows, now);
  const rest = todayRows
    .filter((r) => r !== hero)
    .sort((a, b) => postWeight(b) - postWeight(a) || new Date(effectiveTime(a)) - new Date(effectiveTime(b)) || tiebreak(a, b));

  heroEl.innerHTML = hero ? heroCardHtml(hero) : "";
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
  const img = safeImageUrl(update);
  const upcoming = update.event_time && new Date(update.event_time) > new Date();
  const status =
    update.status === "cancelled"
      ? `<span class="badge badge-cancelled">Cancelled</span>`
      : !badgesHtml(update) && upcoming
        ? `<span class="badge badge-soon">Up next</span>`
        : "";
  const badges = `<div class="hero-badges">${badgesHtml(update)}${status}</div>`;
  const media = img
    ? `<div class="hero-media has-image"><img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.hero-media').className='hero-media is-pattern';this.remove()">${badges}</div>`
    : `<div class="hero-media is-pattern"><span class="hero-media-icon">${icon(meta.iconId, { size: 24 })}</span>${badges}</div>`;
  return `
  <article class="hero-card hero-v2" style="--c:var(--type-${update.type}-hero)" data-update-id="${update.id}">
    ${media}
    <div class="hero-body">
      <div class="hero-eyebrow"><span class="hero-type"><i></i>${meta.label}</span></div>
      <h2 class="hero-title">${escapeHtml(update.title)}</h2>
      ${chipsHtml(update)}
      ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="hero-footer" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)}</span>
        ${feedbackToggleHtml(update)}
      </div>
      ${feedbackRowHtml(update)}
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
  const img = safeImageUrl(update);
  const lead = event
    ? dateTileHtml(update.event_time, update.type)
    : `<div class="list-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 22 })}</div>`;
  const thumb = img ? `<img class="card-thumb" src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "";
  const badges = badgesHtml(update);
  const body = `
    ${lead}
    <div class="list-body">
      <div class="list-kicker" style="color:var(--type-${update.type}-icon)"><i></i>${meta.label}${badges ? `<span class="kicker-badges">${badges}</span>` : ""}</div>
      <div class="list-title">${escapeHtml(update.title)}</div>
      <div class="list-meta">${metaLine(update, { skipDate: event })}</div>
      ${update.body ? `<p class="list-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="list-updated" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)}</span>
      </div>
      ${feedbackRowHtml(update)}
    </div>
    ${thumb}`;
  const cls = `list-card ${event ? "card-event" : "card-announcement"}${pr !== "normal" ? ` is-${pr}` : ""}`;
  if (update.status === "cancelled") {
    return `<div class="hist-card" data-update-id="${update.id}" style="background:var(--type-${update.type}-list)">
      ${cancelledBanner()}
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
      ${feedbackToggleHtml(update)}
    </div>
    ${feedbackRowHtml(update) ? `<div style="padding:0 14px 14px">${feedbackRowHtml(update)}</div>` : ""}`;
  if (update.status === "cancelled") {
    return `<div class="hist-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${cancelledBanner()}${row}</div>`;
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

// ── Feedback ─────────────────────────────────────────────────────────────

function feedbackToggleHtml(update) {
  if (!update.accepts_feedback) return "";
  return `<button type="button" class="btn feedback-toggle" data-feedback-toggle="${update.id}">Feedback</button>`;
}

function feedbackRowHtml(update) {
  if (!update.accepts_feedback) return "";
  return `
  <div class="feedback-row" id="feedback-row-${update.id}">
    <form class="feedback-form" data-feedback-form="${update.id}">
      <div class="field"><label>Your feedback</label><textarea class="input" name="body" required placeholder="Share a thought about this post…"></textarea></div>
      <div class="rating-row">Rating (optional):
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star" data-rating="${n}">${n}</button>`).join("")}
        <input type="hidden" name="rating" value="">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="submit" class="btn btn-primary">Submit</button>
        <span class="feedback-status"></span>
      </div>
    </form>
  </div>`;
}

function wireFeedbackDelegation() {
  document.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest("[data-feedback-toggle]");
    if (toggleBtn) {
      const id = toggleBtn.dataset.feedbackToggle;
      const row = document.getElementById(`feedback-row-${id}`);
      row.classList.toggle("open");
      return;
    }
    const star = e.target.closest(".rating-star");
    if (star) {
      const form = star.closest("form");
      form.querySelectorAll(".rating-star").forEach((s) => s.classList.remove("selected"));
      const value = Number(star.dataset.rating);
      const current = Number(form.querySelector('input[name="rating"]').value);
      const next = current === value ? 0 : value;
      form.querySelector('input[name="rating"]').value = next || "";
      if (next) {
        form.querySelectorAll(".rating-star").forEach((s) => {
          if (Number(s.dataset.rating) <= next) s.classList.add("selected");
        });
      }
      return;
    }
  });

  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-feedback-form]");
    if (!form) return;
    e.preventDefault();
    const updateId = form.dataset.feedbackForm;
    const statusEl = form.querySelector(".feedback-status");
    const submitBtn = form.querySelector('button[type="submit"]');
    const body = form.querySelector('[name="body"]').value.trim();
    const ratingRaw = form.querySelector('[name="rating"]').value;
    if (!body) return;

    submitBtn.disabled = true;
    statusEl.textContent = "";
    statusEl.className = "feedback-status";

    const { error } = await supabase.from("feedback").insert({
      update_id: updateId,
      body,
      rating: ratingRaw ? Number(ratingRaw) : null,
    });

    submitBtn.disabled = false;
    if (error) {
      console.error("Feedback submit failed", error);
      statusEl.textContent = "Couldn't submit — try again.";
      statusEl.className = "feedback-status feedback-error";
      return;
    }
    form.reset();
    form.querySelectorAll(".rating-star").forEach((s) => s.classList.remove("selected"));
    statusEl.textContent = "Thanks — feedback sent.";
    statusEl.className = "feedback-status feedback-sent";
  });
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
  const el = document.querySelector(`[data-update-id="${id}"]`);
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
  if (row.status === "deleted") handleDeleted(row.id);
  else if (row.status === "cancelled") handleCancelled(row);
  else if (row.status === "active") handleActiveArrival(row);
}

function removeFromSets(id) {
  todayRows = todayRows.filter((r) => r.id !== id);
  upcomingRows = upcomingRows.filter((r) => r.id !== id);
}

function handleActiveArrival(row) {
  const now = new Date();
  const bucket = bucketOf(row, now);

  removeFromSets(row.id);
  if (bucket === "history") {
    const el = document.querySelector(`[data-update-id="${row.id}"]`);
    if (el && historyEl.contains(el)) el.outerHTML = histCardHtml(row);
    return;
  }

  (bucket === "today" ? todayRows : upcomingRows).push(row);

  if (isScrolledNearTop()) {
    renderToday(now);
  } else {
    hasDeferredTodayUpdate = true;
    newUpdatePill.hidden = false;
  }
}

function handleCancelled(row) {
  const now = new Date();
  const inToday = todayRows.some((r) => r.id === row.id);
  const inUpcoming = upcomingRows.some((r) => r.id === row.id);

  if (inToday || inUpcoming) {
    const wasHero = inToday && pickHero(todayRows, now)?.id === row.id;
    removeFromSets(row.id);
    const bucket = bucketOf(row, now);
    if (bucket === "today") todayRows.push(row);
    else if (bucket === "upcoming") upcomingRows.push(row);

    if (wasHero || bucket === "history") {
      renderToday(now);
    } else {
      const el = document.querySelector(`[data-update-id="${row.id}"]`);
      if (el) el.outerHTML = listCardHtml(row);
    }
    return;
  }

  const el = document.querySelector(`[data-update-id="${row.id}"]`);
  if (el) el.outerHTML = histCardHtml(row);
}

function handleDeleted(id) {
  const el = document.querySelector(`[data-update-id="${id}"]`);
  const inSets = todayRows.some((r) => r.id === id) || upcomingRows.some((r) => r.id === id);

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

function animateRemove(el, onDone) {
  const height = el.getBoundingClientRect().height;
  el.style.maxHeight = `${height}px`;
  el.classList.add("realtime-removing");
  void el.offsetHeight; // force reflow so the max-height transition actually animates
  requestAnimationFrame(() => el.classList.add("collapsing"));

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    el.remove();
    onDone?.();
  };
  el.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 500); // fallback in case transitionend doesn't fire
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
