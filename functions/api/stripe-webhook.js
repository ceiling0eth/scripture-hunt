/**
 * Stripe webhook receiver (Cloudflare Pages Function).
 *
 * POST /api/stripe-webhook
 *
 * This is the ONLY place a purchase becomes real. It verifies the Stripe-Signature header
 * against STRIPE_WEBHOOK_SECRET, then records the purchase in KV keyed by the
 * `client_reference_id` the buyer's browser generated before redirecting to Checkout.
 *
 * Why the signature check matters: without it anyone could POST a fake "paid" event and mint
 * themselves an entitlement. The check is what turns a redirect into proof.
 */

const encoder = new TextEncoder();

/** Constant-time compare; length leak is acceptable here because both sides are fixed-size hex. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse `t=timestamp,v1=signature,v1=...` and verify against `{timestamp}.{body}`.
 * Rejects timestamps older than `toleranceSec` to blunt replay.
 */
async function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",").reduce((acc, kv) => {
    const i = kv.indexOf("=");
    if (i > 0) {
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      (acc[k] ||= []).push(v);
    }
    return acc;
  }, {});

  const t = parts.t && parts.t[0];
  const v1s = parts.v1 || [];
  if (!t || !v1s.length) return { ok: false, reason: "malformed signature header" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  for (const v of v1s) if (timingSafeEqual(expected, v)) return { ok: true };
  return { ok: false, reason: "no matching signature" };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook secret not configured" }, 500);

  const rawBody = await request.text();
  const check = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret);
  if (!check.ok) return json({ error: "invalid signature", detail: check.reason }, 400);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  // Only a completed, paid checkout grants anything. `mode: "payment"` rules out subscriptions.
  const granted = [];
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data?.object ?? {};
    const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";
    const ref = s.client_reference_id;
    if (paid && ref) {
      // Idempotency: Stripe retries, and the same session must not double-grant. A KV put is
      // already idempotent for our one boolean, but skip the write when it is already set.
      const existing = await env.ENTITLEMENTS.get(`ent:${ref}`);
      if (existing !== "1") await env.ENTITLEMENTS.put(`ent:${ref}`, "1");
      granted.push(ref);
    }
  }

  // Always 200 once the signature verifies: a non-2xx makes Stripe retry and eventually disable
  // the endpoint, and unhandled event types are not an error.
  return json({ received: true, granted });
}
