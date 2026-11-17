/**
 * Behaviour counters (Cloudflare Pages Function).
 *
 * POST /api/track   { event: "started" | "finished" | "paywall" | "shared", ... }
 *
 * Cloudflare Web Analytics reports page views and nothing else, so it cannot tell whether a
 * visitor played. These four counts are the smallest set that answers the only questions worth
 * asking later:
 *
 *   started  — a verse was dealt           (did anyone actually start?)
 *   finished — a verse was completed       (did they get through one?)
 *   paywall  — free verses ran out         (did they hit the ask?)
 *   shared   — the share button was used   (did anyone pass it on?)
 *
 * Purchases are counted by the Stripe webhook, not here.
 *
 * No identifier of any kind is stored: the body must not contain one, and the key is just the
 * event name plus a UTC day. That means these are counts, not funnels per user — which is the
 * trade for keeping the "store nothing about users" promise.
 */

const ALLOWED = new Set(["started", "finished", "paywall", "shared"]);
const CORS = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);   // YYYY-MM-DD, UTC
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const event = body && body.event;
  if (!ALLOWED.has(event)) return json({ ok: false, error: "unknown event" }, 400);

  if (!env.ENTITLEMENTS) return json({ ok: false, error: "storage not configured" }, 500);

  const key = `stat:${dayKey()}:${event}`;
  try {
    const current = Number((await env.ENTITLEMENTS.get(key)) || 0);
    // KV has no atomic increment. A lost update under concurrency costs one count, which is fine
    // for a counter nobody bills against — do not add a Durable Object for this.
    await env.ENTITLEMENTS.put(key, String(current + 1));
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 500);
  }
}

// Convenience for reading the numbers back without a dashboard.
// GET /api/track?day=2026-11-17 -> { started, finished, paywall, shared }
export async function onRequestGet({ request, env }) {
  const day = new URL(request.url).searchParams.get("day") || dayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "bad day" }, 400);
  if (!env.ENTITLEMENTS) return json({ error: "storage not configured" }, 500);

  const out = { day };
  for (const name of ALLOWED) {
    out[name] = Number((await env.ENTITLEMENTS.get(`stat:${day}:${name}`)) || 0);
  }
  return json(out);
}
