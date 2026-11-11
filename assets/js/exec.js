import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js?v=12";
import { TYPE_META, typeBanner, escapeHtml, formatTime, formatDateHeading, formatEventDate, localDateKey, roomLabel, cancelledBanner } from "./shared.js?v=24";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginSubmit = document.getElementById("login-submit");
const logoutBtn = document.getElementById("logout-btn");

const newPostToggle = document.getElementById("new-post-toggle");
const newPostChev = document.getElementById("new-post-chev");
const postForm = document.getElementById("post-form");
const typeGrid = document.getElementById("type-grid");
const locationLabel = document.getElementById("location-label");
const formError = document.getElementById("form-error");
const discardBtn = document.getElementById("discard-btn");
const execNav = document.getElementById("exec-nav");
const submitBtn = postForm.querySelector('button[type="submit"]');
const timeHint = document.getElementById("time-hint");

const listView = document.getElementById("list-view");
const listEl = document.getElementById("events-list");
const listSkeleton = document.getElementById("list-skeleton");

const detailView = document.getElementById("detail-view");
const detailBack = document.getElementById("detail-back");
const detailSkeleton = document.getElementById("detail-skeleton");
const detailContent = document.getElementById("detail-content");
const detailCardEl = document.getElementById("detail-card");
const notesForm = document.getElementById("notes-form");
const notesInput = document.getElementById("notes-input");
const notesStatus = document.getElementById("notes-status");
const cancelForm = document.getElementById("cancel-form");
const cancelReasonInput = document.getElementById("cancel-reason");
const cancelCount = document.getElementById("cancel-count");
const cancelError = document.getElementById("cancel-error");
const cancelBack = document.getElementById("cancel-back");
const eventsCount = document.getElementById("events-count");
const detailActionbar = document.getElementById("detail-actionbar");
const detailHint = document.getElementById("detail-hint");

let selectedType = "prayer";
let currentUserId = null;
let currentDetailUpdate = null;
let execChannel = null;


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
    execNav.hidden = true;
    teardownRealtime();
    return;
  }
  currentUserId = session.user.id;
  loginView.hidden = true;
  appView.hidden = false;
  showListView();
  await loadEventsAndHeader();
  setupRealtime();

  // Reload deep-links back into whichever post was open (exec.html#post-<id>)
  // instead of always dropping back to the list.
  if (location.hash.startsWith("#post-")) {
    openDetail(location.hash.slice(6));
  }
}

// ── Realtime ─────────────────────────────────────────────────────────────
// Execs can SELECT every row (no RLS visibility-transition problem like the
// reader page has), so this just patches or prepends cards directly — no
// deferral, no animation, matching the exec list's existing "show every
// status inline" design.

function setupRealtime() {
  if (execChannel) return;
  execChannel = supabase
    .channel("exec-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "updates" }, (payload) => {
      if (payload.new && payload.new.type !== "exec_meeting") applyExecRealtimeRow(payload.new);
    })
    .subscribe();
}

function teardownRealtime() {
  if (!execChannel) return;
  supabase.removeChannel(execChannel);
  execChannel = null;
}

// An existing post is patched where it already sits, so cancelling, pinning or
// editing never moves it. Only a brand-new post is added (at the top).
function applyExecRealtimeRow(row) {
  const html = execCardHtml(row);
  const existingEl = listEl.querySelector(`[data-update-id="${row.id}"]`);

  if (existingEl) {
    existingEl.outerHTML = html;
    syncEventsCount();
    return;
  }

  const emptyState = listEl.querySelector(".empty-state");
  if (emptyState) listEl.innerHTML = "";
  listEl.insertAdjacentHTML("afterbegin", html);
  syncEventsCount();
}

function syncEventsCount() {
  eventsCount.textContent = String(listEl.querySelectorAll("[data-update-id]:not(.deleted)").length);
}

// ── View toggle (list ↔ detail) ─────────────────────────────────────────

function showListView() {
  listView.hidden = false;
  detailView.hidden = true;
  execNav.hidden = false;
}

function showDetailView() {
  listView.hidden = true;
  detailView.hidden = false;
  execNav.hidden = true;
}

// ── Login ────────────────────────────────────────────────────────────────

// Executives log in with a username only; no email address is ever collected,
// stored or used. Supabase Auth itself needs an email-shaped identifier, so the
// username is turned into a placeholder on a reserved domain that can never
// receive mail. Anything that isn't a valid username (a real email address
// included) is rejected here and never reaches Supabase.
const AUTH_PLACEHOLDER_DOMAIN = "ummah.example.com";
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}$/; // same rule as executives.username in the database

function usernameToAuthId(input) {
  const username = input.trim().toLowerCase();
  return USERNAME_PATTERN.test(username) ? `${username}@${AUTH_PLACEHOLDER_DOMAIN}` : null;
}

function wireLoginForm() {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = "Logging in…";

    const authId = usernameToAuthId(loginForm.username.value);
    const password = loginForm.password.value;
    const { error } = authId
      ? await supabase.auth.signInWithPassword({ email: authId, password })
      : { error: new Error("Invalid username") };

    loginSubmit.disabled = false;
    loginSubmit.textContent = "Log in";
    if (error) {
      loginError.textContent = "Login failed — check your username and password.";
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

  // Exec meetings are no longer a post type, so any old ones stay out of the list.
  const { data: updates, error: updatesError } = await supabase
    .from("updates")
    .select("*")
    .neq("type", "exec_meeting")
    .order("created_at", { ascending: false })
    .limit(100);

  listSkeleton.hidden = true;

  if (updatesError) {
    listEl.innerHTML = `<div class="empty-state">${icon("i-inbox", { size: 22 })}<div class="title">Couldn't load events.</div></div>`;
    return;
  }

  // Execs see posts in the order they were created (their edit history), not
  // by the event time that readers see.
  listEl.innerHTML = (updates || []).length
    ? (updates || []).map((u) => execCardHtml(u)).join("")
    : `<div class="empty-state">${icon("i-inbox", { size: 22 })}<div class="title">No events posted yet.</div></div>`;
  syncEventsCount();
}

// Same card design as the Updates page, so the two screens read as one app.
function execCardHtml(update) {
  const meta = TYPE_META[update.type];
  if (!meta) return "";

  if (update.status === "deleted") {
    return `
    <div class="list-card exec-item deleted" data-update-id="${update.id}">
      <div class="list-icon">${icon("i-trash", { size: 22 })}</div>
      <div class="list-body">
        <div class="list-title">${escapeHtml(update.title)}</div>
        <div class="list-meta">Deleted · ${formatDateHeading(new Date(update.created_at))}</div>
      </div>
      <span class="badge-pill badge-deleted">Deleted</span>
    </div>`;
  }

  const pinned = update.pinned ? `<span class="kicker-badges"><span class="badge badge-pin">${icon("i-pushpin", { size: 13 })}Pinned</span></span>` : "";
  const body = `
    <div class="list-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 22 })}</div>
    <div class="list-body">
      <div class="list-kicker" style="color:var(--type-${update.type}-icon)"><i></i>${meta.label}${pinned}</div>
      <div class="list-title">${escapeHtml(update.title)}</div>
      <div class="list-meta">${execMetaLine(update)}</div>
    </div>
    ${icon("i-chev", { size: 15 })}`;

  if (update.status === "cancelled") {
    return `<div class="hist-card exec-item" data-update-id="${update.id}" style="background:var(--type-${update.type}-list)">
      ${cancelledBanner(update.cancel_reason)}
      <div class="list-card" style="box-shadow:none;margin-bottom:0">${body}</div>
    </div>`;
  }
  return `<div class="list-card exec-item" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">${body}</div>`;
}

function execMetaLine(update) {
  const isToday = !!update.event_time && localDateKey(update.event_time) === localDateKey(new Date());
  return update.event_time
    ? `${isToday ? "Today" : formatDateHeading(new Date(update.event_time))} ${formatTime(update.event_time)}`
    : formatDateHeading(new Date(update.created_at));
}

// ── New post form ────────────────────────────────────────────────────────

// Prayer and Social posts need a time; announcements don't.
// Until a required time is set the submit button is faded out and reads
// "Set time"; once set (or for announcements) it's the normal "Post update".
function syncSubmitState() {
  const needsTime = selectedType !== "announcement";
  const blocked = needsTime && !postForm.event_time.value;
  submitBtn.disabled = blocked;
  submitBtn.textContent = blocked ? "Set time" : "Post update";
  timeHint.textContent = needsTime ? "(required)" : "(optional)";
}

function wireNewPostForm() {
  postForm.event_time.addEventListener("input", syncSubmitState);
  postForm.event_time.addEventListener("change", syncSubmitState);
  syncSubmitState();

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
    locationLabel.textContent = "Room number";
    syncSubmitState();
  });

  postForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;
    submitBtn.disabled = true;

    const title = postForm.title.value.trim();
    const location = postForm.location.value.trim();
    const timeValue = postForm.event_time.value;
    const body = postForm.notes.value.trim();

    if (!title) {
      formError.textContent = "Title is required.";
      formError.hidden = false;
      syncSubmitState();
      return;
    }
    if (selectedType !== "announcement" && !timeValue) {
      formError.textContent = "Set a time for this post.";
      formError.hidden = false;
      syncSubmitState();
      return;
    }

    const payload = {
      type: selectedType,
      title,
      location: location || null,
      event_time: timeValue ? new Date(timeValue).toISOString() : null,
      body: body || null,
      posted_by: currentUserId,
    };
    // Optional presentation fields are only sent when used.
    const priority = postForm.priority.value;
    const pinned = postForm.pinned.checked;
    const usesExtras = priority !== "normal" || pinned;
    if (priority !== "normal") payload.priority = priority;
    if (pinned) payload.pinned = true;

    const { error } = await supabase.from("updates").insert(payload);

    syncSubmitState();

    if (error) {
      console.error("Post failed", error);
      formError.textContent = usesExtras
        ? "Couldn't post. If you used a priority or pin, make sure the latest database migration has been applied."
        : "Couldn't post — check the required fields and try again.";
      formError.hidden = false;
      return;
    }

    postForm.reset();
    selectedType = "prayer";
    typeGrid.querySelectorAll(".type-option").forEach((b) => b.classList.toggle("selected", b.dataset.type === "prayer"));
    locationLabel.textContent = "Room number";
    syncSubmitState();
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
    closeCancelForm();
    showListView();
    loadEventsAndHeader();
  });

  detailActionbar.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !currentDetailUpdate) return;
    const action = btn.dataset.action;

    // Cancelling asks for a short reason first (shown to readers).
    if (action === "cancel") return openCancelForm();

    // Pin / Unpin only flips the pinned flag; the rest change status.
    let changes;
    if (action === "pin" || action === "unpin") changes = { pinned: action === "pin" };
    else if (action === "delete") changes = { status: "deleted" };
    else changes = currentDetailUpdate.cancel_reason ? { status: "active", cancel_reason: null } : { status: "active" };
    await applyChanges(changes, action);
  });

  cancelReasonInput.addEventListener("input", () => {
    cancelCount.textContent = String(cancelReasonInput.value.length);
    cancelError.hidden = true;
  });

  cancelBack.addEventListener("click", closeCancelForm);

  cancelForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const reason = cancelReasonInput.value.trim().slice(0, 99);
    if (!reason) {
      cancelError.textContent = "Add a short reason for the cancellation.";
      cancelError.hidden = false;
      return;
    }
    await applyChanges({ status: "cancelled", cancel_reason: reason }, "cancel");
  });

  // Notes belong to the one post that is open; the save targets that post's id.
  notesForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentDetailUpdate) return;
    const updateId = currentDetailUpdate.id;
    const saveBtn = notesForm.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    notesStatus.textContent = "Saving…";
    const body = notesInput.value.trim();
    const { error } = await supabase.from("updates").update({ body: body || null }).eq("id", updateId);
    saveBtn.disabled = false;
    if (error) {
      console.error("Failed to save notes", error);
      notesStatus.textContent = "Couldn't save. Try again.";
      return;
    }
    if (currentDetailUpdate && currentDetailUpdate.id === updateId) {
      currentDetailUpdate.body = body || null;
      renderDetailCard(currentDetailUpdate);
    }
    notesStatus.textContent = "Saved.";
  });
  notesInput.addEventListener("input", () => { notesStatus.textContent = ""; });
}

async function applyChanges(changes, action) {
  const target = currentDetailUpdate;
  detailActionbar.querySelectorAll("button").forEach((b) => (b.disabled = true));
  cancelForm.querySelectorAll("button").forEach((b) => (b.disabled = true));

  const { error } = await supabase.from("updates").update(changes).eq("id", target.id);

  cancelForm.querySelectorAll("button").forEach((b) => (b.disabled = false));
  if (error) {
    console.error(`Failed to ${action} post`, error);
    detailActionbar.querySelectorAll("button").forEach((b) => (b.disabled = false));
    if (!cancelForm.hidden) {
      cancelError.textContent = "Couldn't cancel. Check your connection and try again.";
      cancelError.hidden = false;
    } else {
      detailHint.textContent = "Couldn't save that change. Try again.";
    }
    return;
  }

  Object.assign(target, changes);
  closeCancelForm();
  renderDetailCard(target);
  renderNotes(target);
  renderActionBar(target);
}

function openCancelForm() {
  cancelReasonInput.value = "";
  cancelCount.textContent = "0";
  cancelError.hidden = true;
  cancelForm.hidden = false;
  detailActionbar.hidden = true;
  detailHint.hidden = true;
  cancelReasonInput.focus();
}

function closeCancelForm() {
  cancelForm.hidden = true;
  detailActionbar.hidden = false;
  detailHint.hidden = false;
}

async function openDetail(updateId) {
  history.replaceState(null, "", `#post-${updateId}`);
  showDetailView();
  detailSkeleton.hidden = false;
  detailContent.hidden = true;
  closeCancelForm();

  const { data: update, error } = await supabase.from("updates").select("*").eq("id", updateId).single();

  detailSkeleton.hidden = true;

  if (error || !update || !TYPE_META[update.type]) {
    console.error("Failed to load post", error);
    detailContent.hidden = false;
    detailCardEl.innerHTML = `<div class="empty-state">${icon("i-inbox", { size: 22, stroke: 2.9 })}<div class="title">Couldn't load this post.</div></div>`;
    notesForm.hidden = true;
    detailActionbar.innerHTML = "";
    detailHint.textContent = "";
    return;
  }

  currentDetailUpdate = update;
  detailContent.hidden = false;

  renderDetailCard(update);
  renderNotes(update);
  renderActionBar(update);
}

function renderDetailCard(update) {
  const meta = TYPE_META[update.type];
  const statusLabel = update.status === "cancelled" ? "Cancelled" : update.status === "deleted" ? "Deleted" : "Active";

  const chips = [];
  if (update.event_time) {
    chips.push(`<span class="chip">${icon("i-calendar", { size: 14 })}${formatEventDate(update.event_time)}</span>`);
    chips.push(`<span class="chip">${icon("i-clock", { size: 14 })}${formatTime(update.event_time)}</span>`);
  }
  if (update.location) chips.push(`<span class="chip">${icon("i-pin", { size: 13 })}${escapeHtml(roomLabel(update.location))}</span>`);
  if (update.pinned) chips.push(`<span class="chip">${icon("i-pushpin", { size: 13 })}Pinned</span>`);

  const reason = update.status === "cancelled" && update.cancel_reason
    ? `<div><div class="detail-meta-label">Reason</div>${escapeHtml(update.cancel_reason)}</div>`
    : "";

  detailCardEl.innerHTML = `
    <div class="hero-card" style="--c:var(--type-${update.type}-hero)">
      <div class="hero-banner" style="background:var(--type-${update.type}-banner);color:var(--type-${update.type}-hero)">${typeBanner(update.type)}</div>
      <div class="hero-body">
        <div class="hero-eyebrow">
          <span class="hero-type">${icon(meta.iconId, { size: 15 })}${meta.label}</span>
          <span class="hero-status">${statusLabel}</span>
        </div>
        <div class="hero-title">${escapeHtml(update.title)}</div>
        ${chips.length ? `<div class="hero-chips">${chips.join("")}</div>` : ""}
        ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
        <div class="detail-meta-grid">
          <div><div class="detail-meta-label">Created</div>${formatDateHeading(new Date(update.created_at))} ${formatTime(update.created_at)}</div>
          <div><div class="detail-meta-label">Status</div>${statusLabel}</div>
          ${reason}
        </div>
      </div>
    </div>`;
}

// The notes box always belongs to the post that is open.
function renderNotes(update) {
  const deleted = update.status === "deleted";
  notesInput.value = update.body || "";
  notesInput.disabled = deleted;
  notesForm.querySelector('button[type="submit"]').disabled = deleted;
  notesStatus.textContent = "";
  notesForm.hidden = false;
}

// Pin / Unpin: a cancelled post can't be newly pinned, but one that was already
// pinned can still be unpinned.
function pinButtonHtml(update) {
  if (update.pinned) return `<button type="button" class="btn btn-pin-action" data-action="unpin">${icon("i-pushpin", { size: 15 })}Unpin</button>`;
  if (update.status !== "active") return "";
  return `<button type="button" class="btn btn-pin-action" data-action="pin">${icon("i-pushpin", { size: 15 })}Pin</button>`;
}

function renderActionBar(update) {
  if (update.status === "active") {
    detailActionbar.innerHTML = `
      ${pinButtonHtml(update)}
      <button type="button" class="btn btn-cancel-action" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-delete-action" data-action="delete">Delete</button>`;
    detailHint.textContent = update.pinned ? "Active, pinned post. Restore is hidden." : "Active post. Restore is hidden.";
  } else if (update.status === "cancelled") {
    detailActionbar.innerHTML = `
      ${pinButtonHtml(update)}
      <button type="button" class="btn btn-delete-action" data-action="delete">Delete</button>`;
    detailHint.textContent = "Cancelled post. Restore is hidden.";
  } else {
    detailActionbar.innerHTML = `<button type="button" class="btn btn-restore-action" data-action="restore">Restore</button>`;
    detailHint.textContent = "Deleted post. Cancel and Delete are hidden.";
  }
}
