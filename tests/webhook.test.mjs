/**
 * Tests for the Stripe webhook + entitlement Pages Functions.
 *
 * Run: node tests/webhook.test.mjs
 * These run the real handlers against a fake KV and real HMAC signatures, so the signature gate
 * is actually exercised rather than assumed.
 */
import assert from "node:assert";
import { webcrypto } from "node:crypto";

globalThis.crypto ??= webcrypto;

const { onRequestPost } = await import("../functions/api/stripe-webhook.js");
const { onRequestGet } = await import("../functions/api/entitlement.js");

const SECRET = "whsec_test_secret";

/** Minimal KV stand-in: the surface the functions actually use. */
function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    _dump: () => Object.fromEntries(m),
  };
}

async function sign(payload, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${ts},v1=${hex}`;
}

function paidEvent(ref, status = "paid") {
  return JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { payment_status: status, client_reference_id: ref, mode: "payment" } },
  });
}

const REF = "a".repeat(32);
let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("stripe-webhook");

await test("rejects a request with no signature", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF);
  const req = new Request("https://x/api/stripe-webhook", { method: "POST", body });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 400);
  assert.deepEqual(env.ENTITLEMENTS._dump(), {}, "nothing may be recorded without a valid signature");
});

await test("rejects a forged signature", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF);
  const req = new Request("https://x/api/stripe-webhook", {
    method: "POST", body, headers: { "stripe-signature": `t=${Math.floor(Date.now()/1000)},v1=${"0".repeat(64)}` },
  });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 400);
  assert.deepEqual(env.ENTITLEMENTS._dump(), {});
});

await test("rejects a signature made with the wrong secret", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF);
  const req = new Request("https://x/api/stripe-webhook", {
    method: "POST", body, headers: { "stripe-signature": await sign(body, "whsec_wrong") },
  });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 400);
});

await test("rejects a replayed signature outside the tolerance window", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF);
  const old = Math.floor(Date.now() / 1000) - 3600;
  const req = new Request("https://x/api/stripe-webhook", {
    method: "POST", body, headers: { "stripe-signature": await sign(body, SECRET, old) },
  });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 400);
});

await test("records the ref for a valid paid event", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF);
  const req = new Request("https://x/api/stripe-webhook", {
    method: "POST", body, headers: { "stripe-signature": await sign(body) },
  });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.granted, [REF]);
  assert.equal(env.ENTITLEMENTS._dump()[`ent:${REF}`], "1");
});

await test("does not grant when payment_status is unpaid", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF, "unpaid");
  const req = new Request("https://x/api/stripe-webhook", {
    method: "POST", body, headers: { "stripe-signature": await sign(body) },
  });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).granted, []);
  assert.deepEqual(env.ENTITLEMENTS._dump(), {});
});

await test("ignores a valid but unrelated event type", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = JSON.stringify({ type: "customer.created", data: { object: {} } });
  const req = new Request("https://x/api/stripe-webhook", {
    method: "POST", body, headers: { "stripe-signature": await sign(body) },
  });
  const res = await onRequestPost({ request: req, env });
  assert.equal(res.status, 200);
  assert.deepEqual(env.ENTITLEMENTS._dump(), {});
});

await test("is idempotent across Stripe retries", async () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, ENTITLEMENTS: fakeKV() };
  const body = paidEvent(REF);
  for (let i = 0; i < 3; i++) {
    const req = new Request("https://x/api/stripe-webhook", {
      method: "POST", body, headers: { "stripe-signature": await sign(body) },
    });
    assert.equal((await onRequestPost({ request: req, env })).status, 200);
  }
  assert.equal(env.ENTITLEMENTS._dump()[`ent:${REF}`], "1");
});

console.log("entitlement");

await test("unknown ref is not entitled", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  const req = new Request(`https://x/api/entitlement?ref=${"b".repeat(32)}`);
  const data = await (await onRequestGet({ request: req, env })).json();
  assert.equal(data.unlimited, false);
});

await test("a ref the webhook recorded is entitled", async () => {
  const kv = fakeKV();
  await kv.put(`ent:${REF}`, "1");
  const env = { ENTITLEMENTS: kv };
  const req = new Request(`https://x/api/entitlement?ref=${REF}`);
  const data = await (await onRequestGet({ request: req, env })).json();
  assert.equal(data.unlimited, true);
});

await test("missing or malformed ref never entitles", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  for (const q of ["", "?ref=", "?ref=short", "?ref=" + "x".repeat(200), "?ref=has%20space"]) {
    const req = new Request(`https://x/api/entitlement${q}`);
    const res = await onRequestGet({ request: req, env });
    const data = await res.json();
    assert.equal(data.unlimited, false, `should not entitle for ${q}`);
  }
});

console.log(`\n${passed} tests passed`);
