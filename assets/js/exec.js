import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js";
import { TYPE_META, typeBanner, escapeHtml, formatTime, formatDateHeading, localDateKey } from "./shared.js";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginSubmit = document.getElementById("login-submit");
const execNameTag = document.getElementById("exec-name-tag");
const logoutBtn = document.getElementById("logout-btn");

const newPostToggle = document.getElementById("new-post-toggle");
const newPostChev = document.getElementById("new-post-chev");
const postForm = document.getElementById("post-form");
const typeGrid = document.getElementById("type-grid");
const locationLabel = document.getElementById("location-label");
const formError = document.getElementById("form-error");
const discardBtn = document.getElementById("discard-btn");

const listView = document.getElementById("list-view");
const listEl = document.getElementById("events-list");
const listSkeleton = document.getElementById("list-skeleton");

const detailView = document.getElementById("detail-view");
const detailBack = document.getElementById("detail-back");
const detailSkeleton = document.getElementById("detail-skeleton");
const detailContent = document.getElementById("detail-content");
const detailCardEl = document.getElementById("detail-card");
const detailFeedbackCount = document.getElementById("detail-feedback-count");
const detailFeedbackList = document.getElementById("detail-feedback-list");
const detailActionbar = document.getElementById("detail-actionbar");
const detailHint = document.getElementById("detail-hint");

let execNames = new Map(); // user_id -> display_name
let selectedType = "prayer";
let currentUserId = null;
let currentDetailUpdate = null;
let currentDetailFeedbackCount = 0;

const ROOM_LABEL_TYPES = new Set(["prayer", "exec_meeting"]);

init();

async function init() {
  wireLoginForm();
  wireNewPostForm();
  wireDetailView();

  listEl.addEventListener("click", (e) => {
    const card = e.target.closest("[data-update-id]");
    if (!card) return;
    openDetail(card.dataset.updateId);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    renderForSession(session);
  });

  const { data } = await supabase.auth.getSession();
  renderForSession(data.session);
}

async function renderForSession(session) {
  if (!session) {
    currentUserId = null;
    loginView.hidden = false;
    appView.hidden = true;
    return;
  }
  currentUserId = session.user.id;
  loginView.hidden = true;
  appView.hidden = false;
  showListView();
  await loadEventsAndHeader();

  // Reload deep-links back into whichever post was open (exec.html#post-<id>)
  // instead of always dropping back to the list.
  if (location.hash.startsWith("#post-")) {
    openDetail(location.hash.slice(6));
  }
}

// ── View toggle (list ↔ detail) ─────────────────────────────────────────

function showListView() {
  listView.hidden = false;
  detailView.hidden = true;
}

function showDetailView() {
  listView.hidden = true;
  detailView.hidden = false;
}

// ── Login ────────────────────────────────────────────────────────────────

function wireLoginForm() {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = "Logging in…";

    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    loginSubmit.disabled = false;
    loginSubmit.textContent = "Log in";
    if (error) {
      loginError.textContent = "Login failed — check your email and password.";
      loginError.hidden = false;
      return;
    }
    loginForm.reset();
  });

  logoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.href = "index.html";
  });
}

// ── Header + list ────────────────────────────────────────────────────────

async function loadEventsAndHeader() {
  listSkeleton.hidden = false;
  listEl.innerHTML = "";

  const [{ data: execs }, { data: updates, error: updatesError }, { data: feedbackRows }] = await Promise.all([
    supabase.from("exec_directory").select("user_id, display_name"),
    supabase.from("updates").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("feedback").select("update_id"),
  ]);

  execNames = new Map((execs || []).map((e) => [e.user_id, e.display_name]));
  execNameTag.textContent = execNames.get(currentUserId) || "Exec";

  listSkeleton.hidden = true;

  if (updatesError) {
    listEl.innerHTML = `<div class="empty-state">${icon("i-inbox", { size: 22, stroke: 2.75 })}<div class="title">Couldn't load events.</div></div>`;
    return;
  }

  const feedbackCounts = new Map();
  for (const row of feedbackRows || []) {
    feedbackCounts.set(row.update_id, (feedbackCounts.get(row.update_id) || 0) + 1);
  }

  listEl.innerHTML = (updates || []).length
    ? (updates || []).map((u) => execCardHtml(u, feedbackCounts.get(u.id) || 0)).join("")
    : `<div class="empty-state">${icon("i-inbox", { size: 22, stroke: 2.75 })}<div class="title">No events posted yet.</div></div>`;
}

function execCardHtml(update, feedbackCount) {
  const meta = TYPE_META[update.type];

  if (update.status === "deleted") {
    return `
    <div class="exec-card deleted" data-update-id="${update.id}">
      <div class="exec-card-icon">${icon("i-trash", { size: 18, stroke: 2.75 })}</div>
      <div class="exec-card-body">
        <div class="exec-card-title">${escapeHtml(update.title)}</div>
        <div class="exec-card-meta">Deleted · ${formatDateHeading(new Date(update.created_at))} · — ${escapeHtml(attribution(update))}</div>
      </div>
      <span class="badge-pill badge-deleted">Deleted</span>
    </div>`;
  }

  const row = `
    <div class="exec-card" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">
      <div class="exec-card-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 18, stroke: update.type === "prayer" ? 2 : 2.75 })}</div>
      <div class="exec-card-body">
        <div class="exec-card-title">${escapeHtml(update.title)}</div>
        <div class="exec-card-meta">${execMetaLine(update, feedbackCount)}</div>
      </div>
      ${update.type === "exec_meeting" ? `<span class="badge-pill badge-exec">Exec</span>` : `${icon("i-chev", { size: 15, stroke: 2.75 })}`}
    </div>`;

  if (update.status === "cancelled") {
    return `<div class="exec-cancelled-card" data-update-id="${update.id}" style="background:var(--type-${update.type}-list)">
      <div class="cancelled-banner">${icon("i-ban", { size: 14, stroke: 2.4 })}Cancelled</div>
      <div class="exec-card" style="box-shadow:none;margin-bottom:0;background:transparent">
        <div class="exec-card-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 18 })}</div>
        <div class="exec-card-body">
          <div class="exec-card-title">${escapeHtml(update.title)}</div>
          <div class="exec-card-meta">${formatDateHeading(new Date(update.created_at))} · ${escapeHtml(update.body || "")} · — ${escapeHtml(attribution(update))}</div>
        </div>
      </div>
    </div>`;
  }

  return row;
}

function execMetaLine(update, feedbackCount) {
  const parts = [];
  const isToday = localDateKey(update.created_at) === localDateKey(new Date());
  if (update.event_time) {
    parts.push(`${isToday ? "Today" : formatDateHeading(new Date(update.event_time))} ${formatTime(update.event_time)}`);
  } else {
    parts.push(formatDateHeading(new Date(update.created_at)));
  }
  if (update.type === "exec_meeting") {
    if (update.location) parts.push(escapeHtml(update.location));
    parts.push("exec only");
  } else {
    parts.push(`${feedbackCount} feedback`);
  }
  parts.push(`— ${escapeHtml(attribution(update))}`);
  return parts.join(" · ");
}

function attribution(update) {
  return execNames.get(update.posted_by) || "an exec";
}

// ── New post form ────────────────────────────────────────────────────────

function wireNewPostForm() {
  newPostToggle.addEventListener("click", () => {
    const willOpen = !postForm.classList.contains("open");
    postForm.classList.toggle("open", willOpen);
    newPostChev.classList.toggle("collapsed", !willOpen);
  });

  discardBtn.addEventListener("click", () => {
    postForm.classList.remove("open");
    newPostChev.classList.add("collapsed");
    formError.hidden = true;
  });

  typeGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".type-option");
    if (!btn) return;
    selectedType = btn.dataset.type;
    typeGrid.querySelectorAll(".type-option").forEach((b) => b.classList.toggle("selected", b === btn));
    locationLabel.textContent = ROOM_LABEL_TYPES.has(selectedType) ? "Room" : "Location";
  });

  postForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;
    const submitBtn = postForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const title = postForm.title.value.trim();
    const location = postForm.location.value.trim();
    const timeValue = postForm.event_time.value;
    const body = postForm.notes.value.trim();
    const acceptsFeedback = postForm.accepts_feedback.checked;

    if (!title) {
      formError.textContent = "Title is required.";
      formError.hidden = false;
      submitBtn.disabled = false;
      return;
    }

    const { error } = await supabase.from("updates").insert({
      type: selectedType,
      title,
      location: location || null,
      event_time: timeValue ? new Date(timeValue).toISOString() : null,
      body: body || null,
      accepts_feedback: acceptsFeedback,
      posted_by: currentUserId,
    });

    submitBtn.disabled = false;

    if (error) {
      console.error("Post failed", error);
      formError.textContent = "Couldn't post — check the required fields and try again.";
      formError.hidden = false;
      return;
    }

    postForm.reset();
    selectedType = "prayer";
    typeGrid.querySelectorAll(".type-option").forEach((b) => b.classList.toggle("selected", b.dataset.type === "prayer"));
    locationLabel.textContent = "Room";
    postForm.classList.remove("open");
    newPostChev.classList.add("collapsed");
    loadEventsAndHeader();
  });
}

// ── Detail view ──────────────────────────────────────────────────────────

function wireDetailView() {
  detailBack.addEventListener("click", () => {
    currentDetailUpdate = null;
    history.replaceState(null, "", location.pathname + location.search);
    showListView();
    loadEventsAndHeader();
  });

  detailActionbar.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !currentDetailUpdate) return;
    const action = btn.dataset.action;
    const nextStatus = action === "cancel" ? "cancelled" : action === "delete" ? "deleted" : "active";

    detailActionbar.querySelectorAll("button").forEach((b) => (b.disabled = true));

    const { error } = await supabase
      .from("updates")
      .update({ status: nextStatus })
      .eq("id", currentDetailUpdate.id);

    if (error) {
      console.error(`Failed to ${action} post`, error);
      detailActionbar.querySelectorAll("button").forEach((b) => (b.disabled = false));
      return;
    }

    currentDetailUpdate.status = nextStatus;
    renderDetailCard(currentDetailUpdate, currentDetailFeedbackCount);
    renderActionBar(currentDetailUpdate);
  });
}

async function openDetail(updateId) {
  history.replaceState(null, "", `#post-${updateId}`);
  showDetailView();
  detailSkeleton.hidden = false;
  detailContent.hidden = true;

  const [{ data: update, error }, { data: feedbackRows }] = await Promise.all([
    supabase.from("updates").select("*").eq("id", updateId).single(),
    supabase.from("feedback").select("*").eq("update_id", updateId).order("created_at", { ascending: false }),
  ]);

  detailSkeleton.hidden = true;

  if (error || !update) {
    console.error("Failed to load post", error);
    detailContent.hidden = false;
    detailCardEl.innerHTML = `<div class="empty-state">${icon("i-inbox", { size: 22, stroke: 2.75 })}<div class="title">Couldn't load this post.</div></div>`;
    detailFeedbackList.innerHTML = "";
    detailFeedbackCount.textContent = "";
    detailActionbar.innerHTML = "";
    detailHint.textContent = "";
    return;
  }

  currentDetailUpdate = update;
  currentDetailFeedbackCount = (feedbackRows || []).length;
  detailContent.hidden = false;

  renderDetailCard(update, currentDetailFeedbackCount);
  renderFeedbackList(feedbackRows || []);
  renderActionBar(update);
}

function renderDetailCard(update, feedbackCount = 0) {
  const meta = TYPE_META[update.type];
  const statusLabel = update.status === "cancelled" ? " · cancelled" : update.status === "deleted" ? " · deleted" : " · active";
  const kicker = `${meta.label}${statusLabel}${update.type === "exec_meeting" ? " · exec only" : ""}`;

  const chips = [];
  if (update.event_time) chips.push(`<span class="chip">${icon("i-clock", { size: 13, stroke: 2.75 })}${formatTime(update.event_time)}</span>`);
  if (update.location) chips.push(`<span class="chip">${icon("i-pin", { size: 13, stroke: 2.75 })}${escapeHtml(update.location)}</span>`);

  const fourthCell = update.type === "exec_meeting"
    ? `<div><div class="detail-meta-label">Visibility</div>Never shown to readers</div>`
    : `<div><div class="detail-meta-label">Status</div>${statusText(update.status)}</div>`;

  detailCardEl.innerHTML = `
    <div class="hero-card" style="background:var(--type-${update.type}-hero)">
      <div class="hero-banner" style="background:var(--type-${update.type}-banner);color:var(--type-${update.type}-hero)">${typeBanner(update.type)}</div>
      <div class="hero-body">
        <div class="hero-top">
          <div class="hero-icon">${icon(meta.iconId, { size: 22 })}</div>
          <div>
            <div class="hero-kicker" style="color:var(--type-${update.type}-chip)">${kicker}</div>
            <div class="hero-title">${escapeHtml(update.title)}</div>
          </div>
        </div>
        ${chips.length ? `<div class="hero-chips">${chips.join("")}</div>` : ""}
        ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
        <div class="detail-meta-grid">
          <div><div class="detail-meta-label">Posted by</div>${escapeHtml(attribution(update))}</div>
          <div><div class="detail-meta-label">Created</div>${formatDateHeading(new Date(update.created_at))} ${formatTime(update.created_at)}</div>
          <div><div class="detail-meta-label">Feedback</div>${update.accepts_feedback ? "Open" : "Closed"} · ${feedbackCount} received</div>
          ${fourthCell}
        </div>
      </div>
    </div>`;
}

function statusText(status) {
  if (status === "cancelled") return "Cancelled";
  if (status === "deleted") return "Deleted";
  return "Active";
}

function renderFeedbackList(rows) {
  detailFeedbackCount.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"}` : "";
  if (!rows.length) {
    detailFeedbackList.innerHTML = `<div class="empty-state">${icon("i-msg", { size: 20, stroke: 2.75 })}<div class="title">No feedback submitted yet.</div></div>`;
    return;
  }
  detailFeedbackList.innerHTML = rows.map((f) => `
    <div class="feedback-entry">
      ${icon("i-msg", { size: 17, stroke: 2.75 })}
      <div>
        <p class="feedback-entry-body">${escapeHtml(f.body)}</p>
        <div class="feedback-entry-meta">${f.rating ? `Rated ${f.rating}/5 · ` : ""}${formatDateHeading(new Date(f.created_at))} ${formatTime(f.created_at)}</div>
      </div>
    </div>`).join("");
}

function renderActionBar(update) {
  if (update.status === "active") {
    detailActionbar.innerHTML = `
      <button type="button" class="btn btn-cancel-action" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-delete-action" data-action="delete">Delete</button>`;
    detailHint.textContent = "Active post — Restore is hidden.";
  } else if (update.status === "cancelled") {
    detailActionbar.innerHTML = `<button type="button" class="btn btn-delete-action" data-action="delete">Delete</button>`;
    detailHint.textContent = "Cancelled post — Restore is hidden.";
  } else {
    detailActionbar.innerHTML = `<button type="button" class="btn btn-restore-action" data-action="restore">Restore</button>`;
    detailHint.textContent = "Deleted post — Cancel and Delete are hidden.";
  }
}
