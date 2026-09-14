import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js";
import { TYPE_META, escapeHtml, formatTime, formatDateHeading, localDateKey } from "./shared.js";

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

const listEl = document.getElementById("events-list");
const listSkeleton = document.getElementById("list-skeleton");

let execNames = new Map(); // user_id -> display_name
let selectedType = "prayer";
let currentUserId = null;

const ROOM_LABEL_TYPES = new Set(["prayer", "exec_meeting"]);

init();

async function init() {
  wireLoginForm();
  wireNewPostForm();

  supabase.auth.onAuthStateChange((_event, session) => {
    renderForSession(session);
  });

  const { data } = await supabase.auth.getSession();
  renderForSession(data.session);
}

function renderForSession(session) {
  if (!session) {
    currentUserId = null;
    loginView.hidden = false;
    appView.hidden = true;
    return;
  }
  currentUserId = session.user.id;
  loginView.hidden = true;
  appView.hidden = false;
  loadEventsAndHeader();
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
