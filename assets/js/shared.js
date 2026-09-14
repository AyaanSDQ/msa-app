import { icon } from "./icons.js";

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

export function attributionName(update) {
  return update.executive_display_name || "an exec";
}

export function cancelledBanner() {
  return `<div class="cancelled-banner">${icon("i-ban", { size: 14, stroke: 2.4 })}Cancelled</div>`;
}
