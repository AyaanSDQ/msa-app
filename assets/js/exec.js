import { supabase } from "./supabase-client.js";
import { icon } from "./icons.js?v=13";
import {
  describeRule, describeEnds, expandSeries, nextActive, effectiveFields, endBefore, withChange, firstOccurrence,
  isFirstOccurrence, overrideCount, parseKey, dateKey, addDays, startOfDay,
} from "./recurrence.js?v=1";
import { setupRepeat } from "./exec-repeat.js?v=1";
import { TYPE_META, escapeHtml, formatTime, formatDateHeading, formatEventDate, localDateKey, roomLabel, cancelledBanner, animateRemove } from "./shared.js?v=25";

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
const occStrip = document.getElementById("occ-strip");
const editForm = document.getElementById("edit-form");
const editScope = document.getElementById("edit-scope");
const editError = document.getElementById("edit-error");
const deleteForm = document.getElementById("delete-form");
const deleteScope = document.getElementById("delete-scope");
const cancelScope = document.getElementById("cancel-scope");
const detailHint = document.getElementById("detail-hint");

let selectedType = "prayer";
let currentUserId = null;
let currentDetailUpdate = null;
let execChannel = null;
let detailOccDate = null; // for a repeating post: the date being looked at ("YYYY-MM-DD")
let repeatCtl = null;


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
  if (row.status === "deleted") return removeFromList(row.id);
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

// A deleted post leaves the list (sliding out), here and on every other open
// admin screen, and never comes back on reload: the list query skips deleted rows.
function removeFromList(id) {
  const el = listEl.querySelector(`[data-update-id="${id}"]`);
  if (!el) return syncEventsCount();
  animateRemove(el, () => {
    syncEventsCount();
    if (!listEl.querySelector("[data-update-id]")) {
      listEl.innerHTML = `<div class="empty-state">${icon("i-inbox", { size: 22 })}<div class="title">No events posted yet.</div></div>`;
    }
  });
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
    .neq("status", "deleted")
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

  if (update.status === "deleted") return "";

  if (update.recurrence) return seriesCardHtml(update, meta);

  const pinned = update.pinned ? `<span class="kicker-badges"><span class="badge badge-pin">${icon("i-pushpin", { size: 13 })}Pinned</span></span>` : "";
  const body = `
    <div class="list-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 22 })}</div>
    <div class="list-body">
      <div class="list-kicker" style="color:var(--type-${update.type}-icon);--c:var(--type-${update.type}-hero)"><i></i>${meta.label}${pinned}</div>
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

// A repeating post is one row in the list: its rule and the next date, not one row per date.
function seriesCardHtml(update, meta) {
  const pinned = update.pinned ? `<span class="kicker-badges"><span class="badge badge-pin">${icon("i-pushpin", { size: 13 })}Pinned</span></span>` : "";
  const next = nextActive(update, startOfDay(new Date()));
  const when = next
    ? `Next ${execMetaLine(next)}`
    : "Ended";
  const changes = overrideCount(update);
  const meta2 = [describeRule(update.recurrence), when, changes ? `${changes} ${changes === 1 ? "change" : "changes"}` : ""].filter(Boolean).join(" · ");
  return `<div class="list-card exec-item is-series" style="background:var(--type-${update.type}-list)" data-update-id="${update.id}">
    <div class="list-icon" style="color:var(--type-${update.type}-icon)">${icon(meta.iconId, { size: 22 })}</div>
    <div class="list-body">
      <div class="list-kicker" style="color:var(--type-${update.type}-icon);--c:var(--type-${update.type}-hero)"><i></i>${meta.label}<span class="rec-mark">${icon("i-repeat", { size: 12 })}Repeats</span>${pinned}</div>
      <div class="list-title">${escapeHtml(update.title)}</div>
      <div class="list-meta">${escapeHtml(meta2)}</div>
    </div>
    ${icon("i-chev", { size: 15 })}
  </div>`;
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
  repeatCtl = setupRepeat(postForm);
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

    const repeat = repeatCtl.build();
    if (repeat.error) {
      formError.textContent = repeat.error;
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
    if (repeat.rule) {
      // The post's own time is the first date the rule actually produces.
      const first = firstOccurrence(repeat.rule);
      const [hh, mm] = repeat.rule.time.split(":").map(Number);
      payload.event_time = new Date(first.getFullYear(), first.getMonth(), first.getDate(), hh, mm).toISOString();
      payload.recurrence = repeat.rule;
    }
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
      formError.textContent = repeat.rule
        ? "Couldn't post the repeating post. Make sure the latest database migration (recurring posts) has been applied."
        : usesExtras
        ? "Couldn't post. If you used a priority or pin, make sure the latest database migration has been applied."
        : "Couldn't post — check the required fields and try again.";
      formError.hidden = false;
      return;
    }

    postForm.reset();
    repeatCtl.reset();
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
    if (isSeries(currentDetailUpdate)) {
      if (action === "edit") return openEditForm();
      if (action === "restore-occ") return restoreOccurrence();
      if (action === "delete") {
        deleteScope.innerHTML = scopeGroupHtml("delete-scope", scopeOptions("delete", currentDetailUpdate, detailOccDate));
        return openPanel(deleteForm);
      }
    }

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

  occStrip.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-occ]");
    if (!chip || !currentDetailUpdate) return;
    detailOccDate = chip.dataset.occ;
    renderSeriesDetail();
  });
  editForm.addEventListener("submit", (e) => { e.preventDefault(); submitEdit(); });
  document.getElementById("edit-back").addEventListener("click", closeCancelForm);
  deleteForm.addEventListener("submit", (e) => { e.preventDefault(); submitSeriesDelete(); });
  document.getElementById("delete-back").addEventListener("click", closeCancelForm);

  cancelForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const reason = cancelReasonInput.value.trim().slice(0, 99);
    if (!reason) {
      cancelError.textContent = "Add a short reason for the cancellation.";
      cancelError.hidden = false;
      return;
    }
    if (isSeries(currentDetailUpdate)) return submitSeriesCancel(reason);
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

  if (action === "delete") {
    currentDetailUpdate = null;
    history.replaceState(null, "", location.pathname + location.search);
    closeCancelForm();
    showListView();
    removeFromList(target.id);
    return;
  }

  Object.assign(target, changes);
  if (isSeries(target)) return renderSeriesDetail();
  closeCancelForm();
  renderDetailCard(target);
  renderNotes(target);
  renderActionBar(target);
}

const panels = [cancelForm, editForm, deleteForm];

function openPanel(panel) {
  panels.forEach((p) => { p.hidden = p !== panel; });
  detailActionbar.hidden = true;
  detailHint.hidden = true;
}

function openCancelForm() {
  cancelReasonInput.value = "";
  cancelCount.textContent = "0";
  cancelError.hidden = true;
  const series = isSeries(currentDetailUpdate);
  cancelScope.hidden = !series;
  if (series) {
    cancelScope.innerHTML = scopeGroupHtml("cancel-scope", scopeOptions("cancel", currentDetailUpdate, detailOccDate));
    cancelForm.querySelector('button[type="submit"]').textContent = "Cancel";
  } else {
    cancelForm.querySelector('button[type="submit"]').textContent = "Cancel this post";
  }
  openPanel(cancelForm);
  cancelReasonInput.focus();
}

function closeCancelForm() {
  panels.forEach((p) => { p.hidden = true; });
  detailActionbar.hidden = false;
  detailHint.hidden = false;
}

// ── Repeating posts: dates, scope and saving ────────────────────────────

const isSeries = (u) => !!u?.recurrence;

function shortDateLabel(dateStr) {
  return parseKey(dateStr).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// The occurrence being looked at, or null if that date is not (or no longer) one.
function occurrenceOf(row, dateStr) {
  if (!dateStr) return null;
  const d = parseKey(dateStr);
  return expandSeries(row, d, d)[0] || null;
}

function defaultOccurrenceDate(row) {
  const next = nextActive(row, startOfDay(new Date()));
  if (next) return next.occurrence_date;
  const past = expandSeries(row, parseKey(row.recurrence.start), startOfDay(new Date()));
  return past.length ? past[past.length - 1].occurrence_date : null;
}

// What the admin can apply an action to. "This and all future" is not offered on the first
// date (that is the same as the whole series), and cancelling never offers the whole series.
function scopeOptions(kind, row, date) {
  const first = isFirstOccurrence(row.recurrence, date);
  const label = shortDateLabel(date);
  const opts = [{ value: "occurrence", label: "This occurrence", hint: label }];
  if (!first) opts.push({ value: "future", label: "This and all future", hint: kind === "cancel" ? `Cancels ${label} and ends the series there` : `From ${label} on` });
  if (kind !== "cancel") opts.push({ value: "all", label: "All occurrences", hint: "The whole series, including past dates" });
  return opts;
}

function scopeGroupHtml(name, options) {
  return `<legend class="scope-legend">Apply to</legend>` + options.map((o, i) =>
    `<label class="scope-opt"><input type="radio" name="${name}" value="${o.value}"${i === 0 ? " checked" : ""}><span><b>${escapeHtml(o.label)}</b><small>${escapeHtml(o.hint || "")}</small></span></label>`).join("");
}

const readScope = (container) => container.querySelector("input:checked")?.value || "occurrence";

// A short strip of dates: the last two and the next several. Tap one to look at it.
function renderOccStrip(row) {
  const today = startOfDay(new Date());
  const list = [
    ...expandSeries(row, addDays(today, -60), addDays(today, -1)).slice(-2),
    ...expandSeries(row, today, addDays(today, 180)).slice(0, 8),
  ];
  if (detailOccDate && !list.some((o) => o.occurrence_date === detailOccDate)) {
    const picked = occurrenceOf(row, detailOccDate);
    if (picked) list.push(picked);
    list.sort((a, b) => (a.occurrence_date < b.occurrence_date ? -1 : 1));
  }
  occStrip.hidden = false;
  occStrip.innerHTML = `<div class="occ-label">Dates</div><div class="occ-chips">${
    list.length
      ? list.map((o) => `<button type="button" class="occ-chip${o.occurrence_date === detailOccDate ? " selected" : ""}${o.status === "cancelled" ? " is-cancelled" : ""}${new Date(o.event_time) < new Date() ? " is-past" : ""}" data-occ="${o.occurrence_date}">${escapeHtml(shortDateLabel(o.occurrence_date))}</button>`).join("")
      : `<span class="form-hint">No dates left in this series.</span>`
  }</div>`;
}

function renderSeriesDetail() {
  const row = currentDetailUpdate;
  if (!occurrenceOf(row, detailOccDate)) detailOccDate = defaultOccurrenceDate(row);
  closeCancelForm();
  renderDetailCard(row);
  renderOccStrip(row);
  renderNotes(row);
  renderActionBar(row);
}

async function saveSeries(patch, failMessage) {
  const target = currentDetailUpdate;
  detailActionbar.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const { error } = await supabase.from("updates").update(patch).eq("id", target.id);
  detailActionbar.querySelectorAll("button").forEach((b) => (b.disabled = false));
  if (error) {
    console.error("Failed to save repeating post", error);
    detailHint.textContent = failMessage || "Couldn't save that change. Try again.";
    return false;
  }
  Object.assign(target, patch);
  return true;
}

// Remove some fields from every override on/after a date and every "from" change after it
// (used when a wider edit makes them pointless).
function stripFields(row, keys, fromDate) {
  const overrides = {};
  for (const [d, ov] of Object.entries(row.occurrence_overrides || {})) {
    const copy = { ...ov };
    if (!fromDate || d >= fromDate) keys.forEach((k) => delete copy[k]);
    if (Object.keys(copy).length) overrides[d] = copy;
  }
  const changes = [];
  for (const c of row.recurrence.changes || []) {
    const copy = { ...c };
    if (!fromDate || c.from > fromDate) keys.forEach((k) => delete copy[k]);
    if (Object.keys(copy).length > 1) changes.push(copy);
  }
  return { overrides, changes };
}

function openEditForm() {
  const row = currentDetailUpdate;
  const f = effectiveFields(row, detailOccDate);
  editForm.title.value = f.title || "";
  editForm.location.value = f.location || "";
  editForm.time.value = f.time || "";
  editForm.body.value = f.body || "";
  editError.hidden = true;
  editScope.innerHTML = scopeGroupHtml("edit-scope", scopeOptions("edit", row, detailOccDate));
  openPanel(editForm);
  editForm.title.focus();
}

async function submitEdit() {
  const row = currentDetailUpdate;
  const date = detailOccDate;
  const f = effectiveFields(row, date);
  const next = {
    title: editForm.title.value.trim(),
    location: editForm.location.value.trim() || null,
    time: editForm.time.value,
    body: editForm.body.value.trim() || null,
  };
  if (!next.title) { editError.textContent = "Title is required."; editError.hidden = false; return; }
  if (!next.time) { editError.textContent = "Time is required."; editError.hidden = false; return; }

  const changed = {};
  for (const k of ["title", "location", "time", "body"]) if ((next[k] || null) !== (f[k] || null)) changed[k] = next[k];
  if (!Object.keys(changed).length) return closeCancelForm();
  const keys = Object.keys(changed);
  const scope = readScope(editScope);
  let patch;

  if (scope === "occurrence") {
    patch = { occurrence_overrides: { ...(row.occurrence_overrides || {}), [date]: { ...((row.occurrence_overrides || {})[date] || {}), ...changed } } };
  } else if (scope === "future") {
    const { overrides, changes } = stripFields(row, keys, date);
    patch = { recurrence: withChange({ ...row.recurrence, changes }, date, changed), occurrence_overrides: overrides };
  } else {
    const { overrides, changes } = stripFields(row, keys, null);
    const rule = { ...row.recurrence, changes, ...(changed.time ? { time: changed.time } : {}) };
    patch = { recurrence: rule, occurrence_overrides: overrides };
    for (const k of ["title", "location", "body"]) if (k in changed) patch[k] = changed[k];
    if (changed.time) {
      const first = firstOccurrence(rule);
      const [hh, mm] = rule.time.split(":").map(Number);
      patch.event_time = new Date(first.getFullYear(), first.getMonth(), first.getDate(), hh, mm).toISOString();
    }
  }
  if (await saveSeries(patch, "Couldn't save those changes. Try again.")) renderSeriesDetail();
}

// Cancel one date, or this date and everything after it.
async function submitSeriesCancel(reason) {
  const row = currentDetailUpdate;
  const date = detailOccDate;
  const scope = readScope(cancelScope);
  const overrides = { ...(row.occurrence_overrides || {}), [date]: { ...((row.occurrence_overrides || {})[date] || {}), status: "cancelled", cancel_reason: reason } };
  const patch = { occurrence_overrides: overrides };
  if (scope === "future") {
    const cur = row.recurrence.ends?.type === "on" ? row.recurrence.ends.date : null;
    patch.recurrence = { ...row.recurrence, ends: { type: "on", date: cur && cur < date ? cur : date } };
  }
  if (await saveSeries(patch, "Couldn't cancel. Check your connection and try again.")) renderSeriesDetail();
  else { cancelError.textContent = "Couldn't cancel. Check your connection and try again."; cancelError.hidden = false; }
}

async function submitSeriesDelete() {
  const row = currentDetailUpdate;
  const date = detailOccDate;
  const scope = readScope(deleteScope);
  if (scope === "all") return applyChanges({ status: "deleted" }, "delete");
  const patch = scope === "future"
    ? { recurrence: endBefore(row.recurrence, date) }
    : { occurrence_overrides: { ...(row.occurrence_overrides || {}), [date]: { ...((row.occurrence_overrides || {})[date] || {}), status: "deleted" } } };
  if (await saveSeries(patch, "Couldn't delete. Try again.")) renderSeriesDetail();
}

// Put a cancelled date back.
async function restoreOccurrence() {
  const row = currentDetailUpdate;
  const overrides = { ...(row.occurrence_overrides || {}) };
  const ov = { ...(overrides[detailOccDate] || {}) };
  delete ov.status;
  delete ov.cancel_reason;
  if (Object.keys(ov).length) overrides[detailOccDate] = ov;
  else delete overrides[detailOccDate];
  if (await saveSeries({ occurrence_overrides: overrides }, "Couldn't restore that date. Try again.")) renderSeriesDetail();
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

  occStrip.hidden = true;
  if (isSeries(update)) {
    detailOccDate = defaultOccurrenceDate(update);
    return renderSeriesDetail();
  }
  renderDetailCard(update);
  renderNotes(update);
  renderActionBar(update);
}

function renderDetailCard(post) {
  // For a repeating post the card shows the date picked in the strip, with the series rule under it.
  const series = isSeries(post);
  const occ = series ? occurrenceOf(post, detailOccDate) : null;
  const update = occ ? { ...occ, pinned: post.pinned } : post;
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
    <div class="hero-card hero-v2${update.status === "cancelled" ? " is-cancelled" : ""}" style="--c:var(--type-${update.type}-hero)">
      <div class="hero-media is-pattern" data-type="${update.type}"><span class="hero-media-icon">${icon(meta.iconId, { size: 24 })}</span></div>
      <div class="hero-body">
        <div class="hero-eyebrow">
          <span class="hero-type"><i></i>${meta.label}</span>
          <span class="hero-status">${statusLabel}</span>
        </div>
        <h2 class="hero-title">${escapeHtml(update.title)}</h2>
        ${chips.length ? `<div class="hero-chips">${chips.join("")}</div>` : ""}
        ${series ? `<div class="rule-line">${icon("i-repeat", { size: 14 })}${escapeHtml([describeRule(post.recurrence), describeEnds(post.recurrence)].filter(Boolean).join(" · "))}</div>` : ""}
        ${update.body ? `<p class="hero-notes">${escapeHtml(update.body)}</p>` : ""}
        <div class="detail-meta-grid">
          <div><div class="detail-meta-label">Created</div>${formatDateHeading(new Date(post.created_at))} ${formatTime(post.created_at)}</div>
          <div><div class="detail-meta-label">Status</div>${statusLabel}</div>
          ${reason}
        </div>
      </div>
    </div>`;
}

// The notes box always belongs to the post that is open.
function renderNotes(update) {
  const deleted = update.status === "deleted";
  if (isSeries(update)) {
    notesForm.hidden = true; // a repeating post is edited with the Edit form, which asks which dates to change
    return;
  }
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
  if (isSeries(update)) {
    const occ = occurrenceOf(update, detailOccDate);
    const edit = `<button type="button" class="btn btn-secondary" data-action="edit">Edit</button>`;
    const del = `<button type="button" class="btn btn-delete-action" data-action="delete">Delete</button>`;
    detailActionbar.innerHTML = !occ
      ? del
      : `${pinButtonHtml({ ...update, status: "active" })}${edit}${occ.status === "cancelled"
        ? `<button type="button" class="btn btn-restore-action" data-action="restore-occ">Restore</button>`
        : `<button type="button" class="btn btn-cancel-action" data-action="cancel">Cancel</button>`}${del}`;
    detailHint.textContent = occ
      ? `Repeating post. Changes apply to ${shortDateLabel(detailOccDate)} unless you choose more dates.`
      : "No dates left in this series.";
    return;
  }
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
