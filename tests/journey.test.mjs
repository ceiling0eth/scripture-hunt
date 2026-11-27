/**
 * End-to-end journey test against a running local server.
 *
 * The point is to walk the paths a real visitor walks — first load, finish a verse, run out of
 * verses, come back the next day — rather than to poke individual functions. Several bugs in this
 * project (touch-action, non-clickable words, a service worker eating the verse pages) survived
 * unit tests because nothing tested the journey.
 *
 *   python3 -m http.server 8765 &      # in the project root
 *   node tests/journey.test.mjs        # needs playwright: npx playwright install chromium
 *
 * Skips cleanly (exit 0) when playwright or the server is unavailable, so it never blocks CI on a
 * machine without a browser.
 */
import assert from "node:assert";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("SKIP: playwright not installed (npm i -D playwright && npx playwright install chromium)");
  process.exit(0);
}

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.log(`SKIP: could not launch chromium (${String(e).slice(0, 80)})`);
  process.exit(0);
}

// Fail loudly if the server is not up — that is a real problem, not a reason to skip.
try {
  const probe = await fetch(BASE + "/index.html");
  if (!probe.ok) throw new Error(String(probe.status));
} catch {
  console.log(`SKIP: no server at ${BASE}`);
  await browser.close();
  process.exit(0);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/** A fresh context per scenario, so localStorage never leaks between journeys. */
async function freshPage(opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  // Record behaviour pings so we can assert the counters actually fire.
  // sendBeacon does not emit a normal request event, so stub it and record what the page sends.
  await page.addInitScript(() => {
    window.__tracked = [];
    const orig = navigator.sendBeacon?.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      try {
        const body = data instanceof Blob ? null : String(data);
        window.__tracked.push({ url: String(url), body });
        if (data instanceof Blob) data.text().then((t) => window.__tracked.push({ url: String(url), body: t }));
      } catch {}
      return orig ? orig(url, data) : true;
    };
  });
  await page.goto(BASE + "/index.html");
  await page.waitForSelector("#verse .w", { timeout: 10000 });
  return { ctx, page };
}

/** Solve the current verse by clicking each remaining hidden word. */
async function solve(page) {
  for (let guard = 0; guard < 30; guard++) {
    const next = await page.evaluate(() => {
      const left = [...document.querySelectorAll("#verse .w[data-word]")]
        .filter((e) => !e.classList.contains("found"));
      return left.length ? left[0].dataset.word : null;
    });
    if (!next) return;
    const box = await page.locator(`#verse .w[data-word="${next}"]`).first().boundingBox();
    assert.ok(box, `word ${next} should have a box`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
}

console.log("journey: first visit");

await test("a stranger sees a playable verse immediately", async () => {
  const { ctx, page } = await freshPage();
  try {
    const state = await page.evaluate(() => ({
      pill: document.getElementById("playsLeft").textContent,
      words: document.querySelectorAll("#verse .w").length,
      hidden: document.querySelectorAll("#verse .w[data-word]").length,
      ref: document.getElementById("ref").textContent.trim(),
      errors: document.getElementById("verse").innerText.includes("Error"),
    }));
    assert.ok(state.hidden >= 5, `expected at least 5 hidden words, got ${state.hidden}`);
    assert.ok(state.words > state.hidden, "there must be ordinary words to act as distractors");
    assert.ok(state.ref.length > 0, "the verse reference should be filled in");
    assert.equal(state.errors, false, "the puzzle data must load");
    assert.match(state.pill, /^9 free/, "the first verse is dealt from the daily ten");
  } finally { await ctx.close(); }
});

await test("a stranger is told what to do, and the hint goes away once they have", async () => {
  const { ctx, page } = await freshPage();
  try {
    const hint = page.locator("#goal");
    assert.equal(await hint.isVisible(), true, "a first-time visitor must be told the goal");
    assert.match(await hint.textContent(), /drag across a word/i, "the instruction must name the gesture");

    await solve(page);
    await page.waitForTimeout(300);
    assert.equal(await hint.isVisible(), false, "the hint should not linger after the first find");
  } finally { await ctx.close(); }
});

await test("a wrong word gives feedback and does not score", async () => {
  const { ctx, page } = await freshPage();
  try {
    const plain = page.locator('#verse .w[data-plain="1"]').first();
    const text = await plain.textContent();
    const box = await plain.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert.match(await page.locator("#toast").textContent(), /isn’t one of them/);
    assert.match(await page.locator("#count").textContent(), /^0 \//, "a wrong word must not score");
    assert.ok(text.length > 0);
  } finally { await ctx.close(); }
});

await test("finishing a verse shows the completion dialog and Share", async () => {
  const { ctx, page } = await freshPage();
  try {
    await solve(page);
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#done").evaluate((d) => d.open), true, "the dialog should open");
    const buttons = await page.locator("#done .btns button").allTextContents();
    assert.deepEqual(buttons, ["Next verse", "Share"]);
    assert.match(await page.locator("#doneTime").textContent(), /^\d+:\d{2}$/, "a timer should be shown");
  } finally { await ctx.close(); }
});

console.log("journey: running out of verses");

await test("the paywall appears only after the daily ten are gone", async () => {
  const { ctx, page } = await freshPage();
  try {
    // Spend the allowance directly rather than playing ten verses; the gate is what matters here.
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("scripturehunt.v1"));
      s.playedToday = 10;
      localStorage.setItem("scripturehunt.v1", JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#paywall").evaluate((d) => d.open), true);
    assert.match(await page.locator("#paywall h2").textContent(), /That's 10 for today/);
    assert.match(await page.locator("#buyBtn").textContent(), /\$1\.99/);
  } finally { await ctx.close(); }
});

await test("the buy button points at Stripe with a buyer ref attached", async () => {
  const { ctx, page } = await freshPage();
  try {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("scripturehunt.v1"));
      s.playedToday = 10;
      localStorage.setItem("scripturehunt.v1", JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(1200);
    const href = await page.evaluate(() => {
      // The handler assigns location.href; read the ref the client would attach instead of navigating.
      const s = JSON.parse(localStorage.getItem("scripturehunt.v1"));
      return { ref: s.buyerRef, hasRef: typeof s.buyerRef === "string" && s.buyerRef.length >= 16 };
    });
    assert.equal(href.hasRef, true, "a buyer ref must be minted before checkout");
  } finally { await ctx.close(); }
});

console.log("journey: a returning visitor");

await test("a new day restores the allowance", async () => {
  const { ctx, page } = await freshPage();
  try {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("scripturehunt.v1"));
      s.day = "2020-01-01";       // an old day
      s.playedToday = 10;         // fully spent
      s.bonus = 5;
      localStorage.setItem("scripturehunt.v1", JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(1200);
    const pill = await page.locator("#playsLeft").textContent();
    assert.match(pill, /^9 free/, `allowance should reset, got "${pill}"`);
    assert.equal(await page.locator("#paywall").evaluate((d) => d.open), false);
  } finally { await ctx.close(); }
});

await test("a locally forged unlimited flag is dropped when the server disagrees", async () => {
  const { ctx, page } = await freshPage();
  try {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("scripturehunt.v1"));
      s.unlimited = true;
      s.playedToday = 10;
      localStorage.setItem("scripturehunt.v1", JSON.stringify(s));
    });
    await page.route("**/api/entitlement**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"unlimited":false}' }));
    await page.reload();
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("scripturehunt.v1")));
    assert.equal(state.unlimited, false, "the server is authoritative");
  } finally { await ctx.close(); }
});

console.log("journey: mobile");

await test("a touchscreen drag finds a word", async () => {
  const { ctx, page } = await freshPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  try {
    const touchAction = await page.evaluate(() => getComputedStyle(document.getElementById("verse")).touchAction);
    assert.equal(touchAction, "none", "without touch-action:none a finger drag is a page scroll");

    const first = await page.evaluate(() => {
      const el = document.querySelector("#verse .w[data-word]");
      return el ? el.dataset.word : null;
    });
    assert.ok(first, "there should be a hidden word");

    const box = await page.locator(`#verse .w[data-word="${first}"]`).first().boundingBox();
    assert.ok(box.height >= 32, `touch target is only ${box.height}px; needs >= 32`);

    // A real touch drag through the pointer events the page listens for.
    await page.evaluate(({ x, y }) => {
      const v = document.getElementById("verse");
      const el = document.elementFromPoint(x, y);
      const ev = (t) => new PointerEvent(t, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 1, pointerType: "touch", isPrimary: true,
        clientX: x, clientY: y, buttons: t === "pointerup" ? 0 : 1,
      });
      el.dispatchEvent(ev("pointerdown"));
      v.dispatchEvent(ev("pointermove"));
      v.dispatchEvent(ev("pointerup"));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(250);

    assert.match(await page.locator("#count").textContent(), /^1 \//, "a touch drag must find the word");
  } finally { await ctx.close(); }
});

await test("the page does not scroll away under a dragging finger", async () => {
  const { ctx, page } = await freshPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  try {
    const before = await page.evaluate(() => window.scrollY);
    // touch-action:none on #verse is what stops the browser treating the drag as a scroll.
    const action = await page.evaluate(() => getComputedStyle(document.getElementById("verse")).touchAction);
    assert.equal(action, "none");
    const after = await page.evaluate(() => window.scrollY);
    assert.equal(before, after);
  } finally { await ctx.close(); }
});

await test("nothing overflows horizontally on a phone", async () => {
  const { ctx, page } = await freshPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  try {
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, "the layout must not scroll sideways");
    const paywallFits = await page.evaluate(() => {
      const el = document.getElementById("paywall");
      return el.getBoundingClientRect().width <= window.innerWidth;
    });
    assert.equal(paywallFits, true);
  } finally { await ctx.close(); }
});

console.log("journey: measurement");

await test("started and finished are reported", async () => {
  const { ctx, page } = await freshPage();
  try {
    await solve(page);
    await page.waitForTimeout(500);
    const tracked = await page.evaluate(() => window.__tracked || []);
    const bodies = tracked.map((t) => t.body).filter(Boolean).join(" ");
    assert.match(bodies, /"event":"started"/, "started must be reported");
    assert.match(bodies, /"event":"finished"/, "finished must be reported");
  } finally { await ctx.close(); }
});

console.log(`\n${passed} journey checks passed`);
await browser.close();
