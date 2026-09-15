// Called by a database trigger on public.updates (see migration
// 20260914190000_notify_on_post_change.sql) whenever a post is created, or
// cancelled. Sends one OneSignal push to all subscribed readers, deep-linked
// to the post via a #post-<id> anchor that reader.js already scrolls to.
//
// Never called directly by the browser: the trigger authenticates with the
// project's service_role key (stored in Supabase Vault, not in this repo),
// which satisfies this function's default JWT verification.

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://ayaansdq.github.io/msa-app/";

const TYPE_LABEL: Record<string, string> = {
  prayer: "Prayer",
  social: "Social",
  announcement: "Announcement",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: { event?: string; id?: string; type?: string; title?: string; body?: string | null; location?: string | null };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { event, id, type, title, location } = payload;

  // Readers never see exec-meeting posts at all (RLS-enforced) — never
  // notify the general audience about them. No other push channel exists
  // for execs in this MVP, so exec_meeting simply sends nothing.
  if (!id || !type || !title || type === "exec_meeting") {
    return new Response(JSON.stringify({ skipped: true }), { status: 200 });
  }

  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.error("Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY secret");
    return new Response(JSON.stringify({ error: "Server not configured" }), { status: 500 });
  }

  const label = TYPE_LABEL[type] ?? "Update";
  const isCancelled = event === "cancelled";
  const heading = isCancelled ? `${label} cancelled` : `New ${label.toLowerCase()} update`;
  const message = isCancelled
    ? `"${title}" has been cancelled.`
    : [title, location].filter(Boolean).join(" — ");

  const res = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Key ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      target_channel: "push",
      included_segments: ["Subscribed Users"],
      headings: { en: heading },
      contents: { en: message },
      url: `${SITE_URL}#post-${id}`,
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("OneSignal request failed", res.status, result);
  }

  return new Response(JSON.stringify({ ok: res.ok, result }), {
    status: res.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
});
