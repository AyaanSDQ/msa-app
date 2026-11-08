import { icon } from "./icons.js?v=10";

// Per-type presentation, matching design-reference §15 accent table.
export const TYPE_META = {
  prayer: { label: "Prayer", iconId: "i-minaret" },
  social: { label: "Social", iconId: "i-users" },
  announcement: { label: "Announcement", iconId: "i-mega" },
  exec_meeting: { label: "Exec meeting", iconId: "i-case" },
};

export function typeBanner(type) {
  if (type === "announcement") {
    return `<img src="assets/images/announcement-banner.png" alt="Megaphone facing a crowd of silhouetted students">`;
  }
  if (type === "exec_meeting") {
    return `<img src="assets/images/exec-meeting-banner.png" alt="Exec meeting around a table with a presenter at a chart">`;
  }
  const symbolId = type === "social" ? "banner-social" : "banner-mosque";
  return `<svg viewBox="0 0 400 132" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><use href="#${symbolId}"></use></svg>`;
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDateHeading(date) {
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const month = date.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
  return `${weekday} · ${month} ${date.getDate()}`;
}

// "Sun, Nov 15" — the actual date of an event.
export function formatEventDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function localDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatRelative(ts) {
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "Updated just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Updated ${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Updated ${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `Updated ${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

export function cancelledBanner() {
  return `<div class="cancelled-banner">${icon("i-ban", { size: 14, stroke: 2.4 })}Cancelled</div>`;
}

// ── Room labels ──────────────────────────────────────────────────────────
// Rooms starting with 1, 2 or 3 are in Building 1, 2 or 3.
export function buildingFor(location) {
  const m = /^\s*([123])\d{2,3}\b/.exec(location || "");
  return m ? Number(m[1]) : null;
}

export function roomLabel(location) {
  const b = buildingFor(location);
  return b ? `${location} · Building ${b}` : location;
}

// ── Post presentation helpers (priority, pinned, images, event tiles) ────

// Only plain http(s) image links are used.
export function safeImageUrl(update) {
  if (!update.image_url) return "";
  try {
    const u = new URL(update.image_url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

export function priorityOf(update) {
  return update.priority === "urgent" || update.priority === "important" ? update.priority : "normal";
}

// Events with a date (prayers, socials, meetings) get a calendar-style tile.
export function isEventPost(update) {
  return !!update.event_time && update.type !== "announcement";
}

export function badgesHtml(update) {
  const out = [];
  const pr = priorityOf(update);
  if (pr === "urgent") out.push(`<span class="badge badge-urgent">${icon("i-alert", { size: 13 })}Urgent</span>`);
  else if (pr === "important") out.push(`<span class="badge badge-important">${icon("i-star", { size: 13 })}Important</span>`);
  if (update.pinned) out.push(`<span class="badge badge-pin">${icon("i-pushpin", { size: 13 })}Pinned</span>`);
  return out.join("");
}

export function dateTileHtml(ts, type) {
  const d = new Date(ts);
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `<div class="date-tile" style="--c:var(--type-${type}-hero)" aria-hidden="true"><span class="dt-mon">${escapeHtml(month)}</span><span class="dt-day">${d.getDate()}</span></div>`;
}

// ── Illustrated empty states ─────────────────────────────────────────────
// A crescent over a mosque skyline; each kind adds one small detail.
export function emptyIllustration(kind = "today") {
  const detail =
    kind === "calendar"
      ? `<g transform="translate(112 14)"><rect width="30" height="30" rx="8" fill="#fff" stroke="#c3a6e8"/><rect width="30" height="9" rx="8" fill="#7a49b8"/><path d="M8 18h3M14 18h3M20 18h3M8 24h3M14 24h3" stroke="#c3a6e8" stroke-width="2.2" stroke-linecap="round"/></g>`
      : kind === "history"
        ? `<g fill="#fff"><circle cx="22" cy="93" r="2.6"/><circle cx="80" cy="95.5" r="2.6"/><circle cx="138" cy="93" r="2.6"/></g><path d="M22 93c20 5 36 5 58 2.5S118 98 138 93" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="1 5" stroke-linecap="round"/>`
        : `<path d="M118 20l1.4 3.4 3.4 1.4-3.4 1.4-1.4 3.4-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#c3a6e8"/><path d="M40 34l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="#c3a6e8"/>`;
  return `<svg viewBox="0 0 160 100" width="152" height="95" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="eg-${kind}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#e2d6f2"/><stop offset="1" stop-color="#e2d6f2" stop-opacity="0"/></radialGradient>
      <linearGradient id="fd-${kind}"><stop offset="0" stop-color="#000"/><stop offset=".16" stop-color="#fff"/><stop offset=".84" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
      <mask id="mk-${kind}"><rect width="160" height="100" fill="url(#fd-${kind})"/></mask>
    </defs>
    <circle cx="80" cy="40" r="40" fill="url(#eg-${kind})"/>
    <g transform="translate(51 -1) scale(.9)"><path fill="#5b2e91" d="M30.76 15.02A17 17 0 1 0 45.6 38.76A14 14 0 1 1 30.76 15.02Z"/><path fill="#9a6fd0" d="M46 15l1.7 4.1 4.1 1.7-4.1 1.7L46 26.6l-1.7-4.1-4.1-1.7 4.1-1.7z"/></g>
    <g mask="url(#mk-${kind})">
      <path d="M14 82c0-13 16-13 16 0zM130 82c0-13 16-13 16 0z" fill="#c3a6e8"/>
      <path d="M31 82V52l3-9 3 9v30zM123 82V52l3-9 3 9v30z" fill="#c3a6e8"/>
      <path d="M32 40h4M124 40h4" stroke="#c3a6e8" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M48 82V74c0-6 8-6 8 0v8zM104 82V74c0-6 8-6 8 0v8z" fill="#e2d6f2"/>
      <rect x="54" y="68" width="52" height="16" fill="#9a6fd0"/>
      <path d="M54 68c0-24 52-24 52 0z" fill="#9a6fd0"/>
      <path d="M80 44v-5" stroke="#9a6fd0" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M72 84V77a8 8 0 0 1 16 0v7z" fill="#5b2e91" opacity=".9"/>
      <path d="M0 84h160v16H0z" fill="#7a49b8"/>
      <path d="M6 92l4-4 4 4-4 4zM30 92l4-4 4 4-4 4zM54 92l4-4 4 4-4 4zM98 92l4-4 4 4-4 4zM122 92l4-4 4 4-4 4zM146 92l4-4 4 4-4 4z" fill="#c3a6e8" opacity=".75"/>
    </g>
    ${detail}
  </svg>`;
}

export function emptyCardHtml(kind, title, copy, { cta = null, compact = false } = {}) {
  return `<div class="empty-card empty-${kind}${compact ? " compact" : ""}">
    <div class="empty-art">${emptyIllustration(kind)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    ${copy ? `<p class="empty-copy">${escapeHtml(copy)}</p>` : ""}
    ${cta ? `<a class="btn btn-secondary empty-cta" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>` : ""}
  </div>`;
}
