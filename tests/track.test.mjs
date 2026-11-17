/**
 * Tests for the behaviour-counter Pages Function.
 * Run: node tests/track.test.mjs
 */
import assert from "node:assert";

globalThis.crypto ??= (await import("node:crypto")).webcrypto;

const { onRequestPost, onRequestGet } = await import("../functions/api/track.js");

function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    _dump: () => Object.fromEntries(m),
  };
}

const post = (body, env) =>
  onRequestPost({
    request: new Request("https://x/api/track", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    env,
  });

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`  ok  ${name}`); }

console.log("track");

await test("counts a known event", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  const res = await post({ event: "started" }, env);
  assert.equal(res.status, 200);
  const keys = Object.keys(env.ENTITLEMENTS._dump());
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^stat:\d{4}-\d{2}-\d{2}:started$/);
  assert.equal(env.ENTITLEMENTS._dump()[keys[0]], "1");
});

await test("increments on repeat", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  for (let i = 0; i < 3; i++) await post({ event: "finished" }, env);
  const key = Object.keys(env.ENTITLEMENTS._dump())[0];
  assert.equal(env.ENTITLEMENTS._dump()[key], "3");
});

await test("rejects an unknown event", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  const res = await post({ event: "drop_tables" }, env);
  assert.equal(res.status, 400);
  assert.deepEqual(env.ENTITLEMENTS._dump(), {});
});

await test("rejects malformed JSON", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  const res = await post("not json{", env);
  assert.equal(res.status, 400);
});

await test("rejects a body with no event", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  assert.equal((await post({}, env)).status, 400);
});

await test("stores no per-user data", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  await post({ event: "shared", ref: "abc", email: "a@b.c", ip: "1.2.3.4" }, env);
  const dump = env.ENTITLEMENTS._dump();
  // Only the counter key, no properties echoed into storage.
  assert.equal(Object.keys(dump).length, 1);
  assert.match(Object.keys(dump)[0], /:shared$/);
});

await test("fails cleanly when KV is missing", async () => {
  assert.equal((await post({ event: "started" }, {})).status, 500);
});

await test("GET returns all counters for a day", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  await post({ event: "started" }, env);
  await post({ event: "started" }, env);
  await post({ event: "finished" }, env);
  // Counters are written under today's UTC date, so read back without ?day.
  const res = await onRequestGet({ request: new Request("https://x/api/track"), env });
  const data = await res.json();
  assert.equal(data.started, 2);
  assert.equal(data.finished, 1);
  assert.equal(data.paywall, 0);
  assert.equal(data.shared, 0);
  assert.match(data.day, /^\d{4}-\d{2}-\d{2}$/);
});

await test("GET rejects a malformed day", async () => {
  const env = { ENTITLEMENTS: fakeKV() };
  const res = await onRequestGet({ request: new Request("https://x/api/track?day=pm"), env });
  assert.equal(res.status, 400);
});

console.log(`\n${passed} tests passed`);
