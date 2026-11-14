/**
 * Entitlement lookup (Cloudflare Pages Function).
 *
 * GET /api/entitlement?ref=<client_reference_id>
 *   -> { unlimited: true }  only if the Stripe webhook recorded a paid purchase for that ref
 *   -> { unlimited: false } otherwise, including unknown or missing refs
 *
 * The client generates `ref` (a random token it keeps in localStorage) and passes it as
 * `client_reference_id` on the Checkout link. Verification happens here, server-side, so
 * hand-editing a URL unlocks nothing: an attacker would have to guess a ref that a real
 * payment already claimed.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// The ref is an opaque token we generate client-side; cap it so KV keys stay bounded.
const REF_RE = /^[A-Za-z0-9_-]{16,64}$/;

export async function onRequestGet({ request, env }) {
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref) return json({ unlimited: false, reason: "no ref" });
  if (!REF_RE.test(ref)) return json({ unlimited: false, reason: "malformed ref" }, 400);

  const stored = await env.ENTITLEMENTS.get(`ent:${ref}`);
  return json({ unlimited: stored === "1" });
}
