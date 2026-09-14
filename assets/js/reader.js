import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js";
import {
  TYPE_META,
  typeBanner,
  escapeHtml,
  formatTime,
  formatDateHeading,
  isSameLocalDay,
  localDateKey,
  formatRelative,
  cancelledBanner,
} from "./shared.js";

const PAGE_SIZE = 20;
const heroEl = document.getElementById("hero");
const todayEl = document.getElementById("today-posts");
const todayCountEl = document.getElementById("today-count");
const historyEl = document.getElementById("history");
const loadMoreWrap = document.getElementById("load-more-wrap");
const loadMoreBtn = document.getElementById("load-more");
const skeletonEl = document.getElementById("skeleton");
const pageEl = document.getElementById("page");

let execNames = new Map(); // user_id -> display_name
let historyOffset = 0;
let historyDone = false;

init();

async function init() {
  const [{ data: execs }, firstBatch] = await Promise.all([
    supabase.from("exec_directory").select("user_id, display_name"),
    fetchBatch(0, PAGE_SIZE),
  ]);
  execNames = new Map((execs || []).map((e) => [e.user_id, e.display_name]));

  const rows = firstBatch;
  historyOffset = rows.length;
  historyDone = rows.length < PAGE_SIZE;

  const now = new Date();
  const todayRows = rows.filter((r) => isSameLocalDay(new Date(r.created_at), now));
  const historyRows = rows.filter((r) => !isSameLocalDay(new Date(r.created_at), now));

  renderToday(todayRows, now);
  renderHistoryBatch(historyRows);
  updateLoadMoreVisibility();

  skeletonEl.hidden = true;
  pageEl.hidden = false;

  setInterval(refreshRelativeTimestamps, 60_000);
  wireFeedbackDelegation();

  loadMoreBtn.addEventListener("click", handleLoadMore);

  maybeScrollToAnchor();
}

async function fetchBatch(offset, limit) {
  const { data, error } = await supabase
    .from("updates")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error("Failed to load updates", error);
    return [];
  }
  return data;
}

async function handleLoadMore() {
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = "Loading…";
  const rows = await fetchBatch(historyOffset, PAGE_SIZE);
  historyOffset += rows.length;
  if (rows.length < PAGE_SIZE) historyDone = true;
  renderHistoryBatch(rows, { append: true });
  updateLoadMoreVisibility();
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = "Load more";
}

function updateLoadMoreVisibility() {
  loadMoreWrap.hidden = historyDone;
}

// ── Hero selection ──────────────────────────────────────────────────────
// Among today's active posts: prefer the soonest still-upcoming event_time
// ("up next"); if everything scheduled today has already passed, fall back
// to whichever happened most recently; if nothing has a time at all, fall
// back to the most recently posted. Cancelled posts never become the hero
// (spec §12) but still render in "today's other posts" with their badge.
function pickHero(todayRows, now) {
  const eligible = todayRows.filter((r) => r.status === "active");
  if (eligible.length === 0) return null;

  const withTime = eligible.filter((r) => r.event_time);
  const upcoming = withTime
    .filter((r) => new Date(r.event_time) >= now)
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
  if (upcoming.length) return upcoming[0];

  const past = withTime.sort((a, b) => new Date(b.event_time) - new Date(a.event_time));
  if (past.length) return past[0];

  const byCreated = [...eligible].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return byCreated[0];
}

function renderToday(todayRows, now) {
  const hero = pickHero(todayRows, now);
  heroEl.innerHTML = hero ? heroCardHtml(hero) : heroEmptyHtml();

  const rest = todayRows.filter((r) => r !== hero);
  todayCountEl.textContent = String(rest.length);
  todayEl.innerHTML = rest.length
    ? rest.map((r) => listCardHtml(r)).join("")
    : emptyStateHtml("No other updates posted yet for today");
}

function renderHistoryBatch(rows, { append = false } = {}) {
  if (!append) historyEl.innerHTML = "";
  if (rows.length === 0 && !append) {
    historyEl.innerHTML = emptyStateHtml("No past updates yet");
    return;
  }

  let currentGroup = null;
  let groupWrap = null;
  const lastKey = historyEl.dataset.lastGroupKey || null;
  let activeKey = lastKey;

  for (const row of rows) {
    const key = localDateKey(row.created_at);
    if (key !== activeKey) {
      const heading = document.createElement("div");
      heading.className = "date-heading";
      heading.textContent = formatDateHeading(new Date(row.created_at));
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
  return `
  <div class="hero-card" style="background:var(--type-${update.type}-hero)" data-update-id="${update.id}">
    <div class="hero-banner" style="background:var(--type-${update.type}-banner);color:var(--type-${update.type}-hero)">${typeBanner(update.type)}</div>
    <div class="hero-body">
      <div class="hero-top">
        <div class="hero-icon">${icon(meta.iconId, { size: 22 })}</div>
        <div>
          <div class="hero-kicker" style="color:var(--type-${update.type}-chip)">${meta.label}${update.status === "cancelled" ? " · cancelled" : " · up next"}</div>
          <div class="hero-title">${escapeHtml(update.title)}</div>
        </div>
      </div>
      ${chipsHtml(update)}
      ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="hero-footer" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)} · ${escapeHtml(attributionFor(update))}</span>
        ${feedbackToggleHtml(update)}
      </div>
      ${feedbackRowHtml(update)}
    </div>
  </div>`;
}

function heroEmptyHtml() {
  return `<div class="hero-empty">${icon("i-inbox", { size: 26 })}<div>No update posted yet for today</div></div>`;
}

function chipsHtml(update) {
  const chips = [];
  if (update.event_time) chips.push(`<span class="chip">${icon("i-clock", { size: 13, stroke: 2.75 })}${formatTime(update.event_time)}</span>`);
  if (update.location) chips.push(`<span class="chip">${icon("i-pin", { size: 13, stroke: 2.75 })}${escapeHtml(update.location)}</span>`);
  return chips.length ? `<div class="hero-chips">${chips.join("")}</div>` : "";
}

function listCardHtml(update) {
  const meta = TYPE_META[update.type];
  const body = `
    <div class="list-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 19, stroke: 2.75 })}</div>
    <div class="list-body">
      <div class="list-kicker" style="color:var(--type-${update.type}-icon)">${meta.label}</div>
      <div class="list-title">${escapeHtml(update.title)}</div>
      <div class="list-meta">${metaLine(update)}</div>
      ${update.body ? `<p class="list-notes">${escapeHtml(update.body)}</p>` : ""}
      <div class="list-updated" data-updated-at="${update.created_at}">
        <span class="updated-text">${formatRelative(update.created_at)} · ${escapeHtml(attributionFor(update))}</span>
      </div>
      ${feedbackRowHtml(update)}
    </div>`;
  if (update.status === "cancelled") {
    return `<div class="hist-card" data-update-id="${update.id}" style="background:var(--type-${update.type}-list)">
      ${cancelledBanner()}
      <div class="list-card" style="box-shadow:none;margin-bottom:0">${body}</div>
    </div>`;
  }
  return `<div class="list-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${body}</div>`;
}

function histCardHtml(update) {
  const meta = TYPE_META[update.type];
  const row = `
    <div class="hist-row">
      <div class="hist-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 16 })}</div>
      <div class="list-body">
        <div class="hist-title">${escapeHtml(update.title)}</div>
        <div class="hist-meta">${metaLine(update)} · ${escapeHtml(attributionFor(update))}</div>
      </div>
      ${feedbackToggleHtml(update)}
    </div>
    ${feedbackRowHtml(update) ? `<div style="padding:0 14px 14px">${feedbackRowHtml(update)}</div>` : ""}`;
  if (update.status === "cancelled") {
    return `<div class="hist-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${cancelledBanner()}${row}</div>`;
  }
  return `<div class="hist-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${row}</div>`;
}

function metaLine(update) {
  const parts = [];
  if (update.event_time) parts.push(formatTime(update.event_time));
  if (update.location) parts.push(escapeHtml(update.location));
  return parts.join(" · ");
}

function attributionFor(update) {
  return execNames.get(update.posted_by) || "an exec";
}

function emptyStateHtml(text) {
  return `<div class="empty-state">${icon("i-inbox", { size: 22, stroke: 2.75 })}<div class="title">${escapeHtml(text)}</div></div>`;
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
