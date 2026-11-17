# Scripture Hunt

A Bible word-hunt game. A King James verse is shown with 5-8 words hidden inside it — drag across
a word to find it.

**Live:** <https://scripture-hunt.pages.dev>
**Local:** `./start.sh`, then open <http://127.0.0.1:8765>. Opening `index.html` via `file://` will
not work (the browser blocks the puzzle fetch, and `/api/*` only exists on Cloudflare).

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Find a word | Click/drag across it | Drag a finger across it |
| Hint (reveals one word) | `H` or the Hint button | Hint button |
| Next verse | `N` or the New button | New button |
| Share (after finishing) | Share button on the completion dialog | same |
| Clear selection | `Esc` | — |

Every word in the verse is clickable. A wrong word flashes red and says it isn't one of them; only
single words count, so sweeping across a phrase is rejected.

## What it costs to run

Everything here is on Cloudflare's free tier and Stripe's per-transaction pricing. There is no
subscription and no fixed monthly cost.

| Piece | Free allowance | Where it could bite |
|---|---|---|
| Pages hosting + Functions | 100,000 requests/day | far away |
| Cloudflare Web Analytics | unlimited | — |
| **Workers KV** | **1,000 writes/day** | **see below — this is the real ceiling** |
| Stripe | 0 fixed; fee per sale | only when someone buys |

### The KV write ceiling

`/api/track` writes one KV key per event, and the free plan allows **1,000 writes per day**. At up
to 22 events per player per day (10 verses started + 10 finished + 1 paywall + 1 share), that is
roughly **45 engaged visitors per day** before counts start being dropped.

Exceeding it does **not** cost money and does **not** break the game — writes fail silently and the
counters stop moving. That is the whole failure mode.

This is deliberately not optimised yet: traffic is near zero, so the ceiling is not reachable. The
fix when it is needed is to move counters to Workers Analytics Engine, which allows 100,000 writes
per day (currently unbilled) and keeps data for three months. Do that only when the numbers say so.

**Check the counters without opening a dashboard:**

```bash
curl https://scripture-hunt.pages.dev/api/track
# {"day":"2026-11-17","started":12,"finished":7,"paywall":3,"shared":1}
```

## Monetization

| Tier | Price | Status |
|---|---|---|
| Free | — | 10 verses/day, resets at local midnight, 3 starter hints |
| Rewarded ad | free | grants +5 verses — **simulated**, there is no ad network |
| Unlimited | **$1.99 once** | **real Stripe Checkout**, verified server-side |

State lives in `localStorage` under `scripturehunt.v1`.

### Why $1.99 and not $5.99

$5.99 assumes a stranger on a one-page site has already decided to trust you. $1.99 is the "give it
a try" price, and there is exactly one thing to buy so the paywall has one decision in it.

The price shape comes from measured competitor storefronts:

- Every **game** in this category sells one-time unlocks and coin/hint packs, not subscriptions:
  `Bible Word Search` (97K ratings) — `No Ads Forever $5.99` + coins `$0.99-11.99`;
  `Lord's Word` (9.2K) — hint packs `$3.99-6.99` + `No Ads $5.99`;
  `Bible Word Puzzle` (724K) — coin bundles `$0.99-5.99`.
- Only the **tool** apps (`Bible Widgets` 128K, `Bible Mode` 12.8K) run subscriptions
  (`$4.99/wk`, `$35.99-59.99/yr`) — they are opened daily out of habit. A puzzle you can finish is
  not that, so a subscription would be cancelled in week one and earn a bad review.

### How a purchase actually works

```
browser                    Cloudflare                    Stripe
   │                            │                           │
   ├─ make buyerRef (random) ───┤                           │
   ├─ go to Payment Link ?client_reference_id=<ref> ───────►│
   │                            │                           │
   │                            │◄── webhook: session.completed
   │                            ├─ verify Stripe-Signature  │
   │                            ├─ KV: ent:<ref> = "1"      │
   │◄─ redirect /?paid=1 ───────┼───────────────────────────┤
   ├─ poll GET /api/entitlement?ref=<ref> ─►                 │
   │◄─ {unlimited:true} ────────┤                           │
   └─ unlock                   │                           │
```

The server is the only thing that can grant access. `?paid=1` on its own unlocks nothing — the
client asks `/api/entitlement` and takes the server's answer, dropping a locally forged flag if the
server disagrees. `functions/api/stripe-webhook.js` verifies the HMAC before writing anything, so a
forged or replayed request records nothing.

**Client-side state is only a cache.** Clearing site data loses the local unlock; the purchase still
exists at Stripe and under `ent:<ref>`, and the paywall says so.

## Measurement

Two layers, both free:

1. **Cloudflare Web Analytics** (`beacon.min.js`, token in `index.html`) — visits and page views,
   no cookies, no fingerprinting.
2. **`/api/track`** — the four counts page views cannot give you: `started`, `finished`, `paywall`,
   `shared`. Purchases are counted by the Stripe webhook.

**No user data is stored.** The request body may not carry an identifier and nothing is echoed into
storage; each event is just `stat:<YYYY-MM-DD>:<event>` holding an integer. That means these are
counts, not per-person funnels — the deliberate trade for storing nothing about users.

The first number worth reading is **`finished / started`**. Under ~50% means people open a verse and
do not get through it, and that is a product problem, not a traffic problem.

## SEO

The app is one HTML file that deals a random verse, so a crawler sees one page with no content.
`tools/build_verse_pages.py` generates one static page per puzzle at `/v/<book-chapter-verse>/` with
the verse text, the hidden word list, prev/next links, a canonical URL and schema.org `Game`
markup — 600 entry points for long-tail queries like `"Psalm 23 word search"`, which is the only SEO
lever available to a new domain with no backlinks.

A visitor arriving with `?verse=<slug>` is shown that exact verse even when their daily allowance is
spent: they came from a search result for this passage, and charging them before they see it wastes
the click.

`robots.txt` and `sitemap.xml` (601 URLs) are generated by the same script. The site is verified in
Google Search Console; the verification file and meta tag must both stay.

**Risk to watch:** 600 near-identical templates can be classified as doorway pages. The mitigation
is that each page carries the real verse text rather than being an empty shell. The tell will be
Search Console reporting a large "Crawled – currently not indexed" count; if that happens this
approach needs replacing.

## Naming

Shipped as **Scripture Hunt**. The working title `Scripture Search` collided with the two installed
leaders (`Bible Word Search` 97K, `Bible Word Puzzle` 724K) and with two tiny live apps that already
rank for that phrase (`Search The Scriptures` 38 ratings, `Scripture Search Quiz` 6). `Hunt` also
matches the mechanic (drag to find), which `Search` did not.

Domain candidates checked over RDAP (`.com`): `scripturesearch.com` taken (1999),
`biblewordgame.com` taken (2005), `versesearch.com` taken (2018), **`scripturehunt.com` available**,
`biblewordhunt.com` available. Not bought — the site runs on the free `pages.dev` domain until there
is traffic to justify it.

## Data

- `data/puzzles.json` — 600 puzzles (~159 KB): `{ref, text, words[]}`.
- `data/pool_final.json` — 2,686 dictionary-verified playable words.
- `data/kjv/` — the 66-book King James Version source (`aruljohn/Bible-kjv`, MIT packaging of the
  public-domain KJV text). Gitignored; re-fetch with `data/fetch_kjv.py`.
- `data/corpus.json` — 31,102 verses + word frequencies (build artifact, gitignored).

### Pipeline

```
data/fetch_kjv.py          -> data/kjv/*.json (66 books, 31,102 verses)
tools/build_puzzles.py     -> data/corpus.json, data/pool_final.json, data/puzzles.json
tools/build_verse_pages.py -> v/**/index.html, sitemap.xml, robots.txt
```

The word pool requires every candidate to appear in `/usr/share/dict/web2` (with inflection
stemming), which drops the proper nouns and archaic forms (`ABIJAH`, `-ETH` verbs) a player could
never guess.

## Design constraints the build enforces

`python3 tools/check_puzzles.py` must exit 0. For every puzzle it asserts:

1. Each declared word maps to **exactly one** clickable token, under the same tokenizer the browser
   uses (`/[A-Za-z]+(?:['’][A-Za-z]+)?/g`). This is what keeps a puzzle completable.
2. No duplicate entries in `words[]`.
3. Word count within 5-14.
4. Every word is in the verified pool.
5. **At least 30% of a verse's content words (4+ letters, non-function) stay as distractors.**
   Without this the game degrades into "click every word that looks like a noun".

`node tests/webhook.test.mjs` (11 tests) covers the payment gate with real HMACs: no signature,
forged signature, wrong secret, replayed timestamp, unpaid status, unrelated event type, idempotency
across retries, and entitlement lookups for unknown/malformed refs.

`node tests/track.test.mjs` (9 tests) covers the counters, including that no per-user data survives
into storage.

### Bugs these checks caught

- **Words repeated in a verse.** `2 Samuel 11:13` lists `WENT` twice; finding one occurrence marked
  the shared token found and the counter could never reach the target. Words are now hidden only if
  they occur exactly once.
- **Possessives.** `harlot’s`, `father’s` — the tokenizer keeps the `’s`, so a declared `HARLOT`
  never matched. Only bare words are eligible.
- **Non-hidden words were not clickable.** Only hidden words got a `<span>`, so a wrong guess was
  impossible and produced no feedback — the player was guessing blind. Every word is a target now.
- **Almost no distractors.** The first generator hid *every* pool word (64% of content words on
  average, 93 puzzles above 80%), which made "click the nouns" a 100% strategy. Hiding 40-65% brings
  that down to 45-63%.
- **The service worker hijacked the verse pages.** Every navigation fell back to the cached app
  shell, replacing `/v/*` with a random-verse page and destroying what the crawler indexes. `/v/` is
  now skipped in the fetch handler.

## File map

```
index.html                    the whole game
sw.js, manifest.json, icons/  PWA
functions/api/stripe-webhook.js   verifies Stripe-Signature, records ent:<ref>
functions/api/entitlement.js      GET ?ref= -> {unlimited:bool}
functions/api/track.js            POST counters, GET reads them back
tools/build_puzzles.py            KJV -> word pool -> puzzles.json
tools/build_verse_pages.py        puzzles.json -> /v/ pages + sitemap
tools/check_puzzles.py            playability gate
tests/*.test.mjs                   webhook + counter tests
```

## Deploy

Cloudflare Pages with Git integration: push to `main` and it rebuilds. There is **no
`wrangler.toml`** on purpose — while one exists, Cloudflare refuses KV bindings from the Dashboard
("Only Secrets can be managed via the Dashboard"), and its KV syntax is for Workers, not Pages
Functions.

The project needs two things configured in the Cloudflare Dashboard, not in this repo:

| Type | Name | Value |
|---|---|---|
| KV binding | `ENTITLEMENTS` | namespace `scripture-hunt-entitlements` |
| Secret | `STRIPE_WEBHOOK_SECRET` | the `whsec_...` from the Stripe webhook endpoint |

Changing either requires a redeploy to take effect.

## Why this exists

Market research (`../research/religion-app-category-gaps-2026-11.md`) found the Bible puzzle/trivia
shape has the highest observed success rate in the category (8.2% of such apps reach 5,000+ ratings,
vs 2.7% for short-video). Four winners launched in 2025 — `Bible Word Search` 97,545 ratings,
`Bible Solitaire` 86,776, `Bible Trivia` 86,472, `Bible Tiles` 22,225.

The bet: people who read the Bible daily already re-read the same verses, so hunting words inside
familiar text is a warm, low-friction loop — not a vocabulary quiz. That bet is **not yet tested**:
as of this writing nobody outside the build has played it.
