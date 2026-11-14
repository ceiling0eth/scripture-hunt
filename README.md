# Scripture Hunt

A Bible word-hunt game. A King James verse is shown with 5-14 words hidden inside it —
drag across a word to find it.

**Play:** `python3 -m http.server 8765` in this folder, then open <http://127.0.0.1:8765>.
Opening `index.html` directly with `file://` will not work (the browser blocks the puzzle fetch).

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Find a word | Click/drag across it | Drag a finger across it |
| Hint (reveals one word) | `H` or the Hint button | Hint button |
| Next verse | `N` or the New button | New button |
| Clear selection | `Esc` | — |

Every word in the verse is clickable. A wrong word flashes red and tells you it isn't one of them;
only single words count, so sweeping across a phrase is rejected.

## Monetization

| Tier | Price | What it does |
|---|---|---|
| Free | — | 3 verses/day, resets at local midnight, 3 starter hints |
| Rewarded ad | free | 30s (demo: 5s), grants +2 verses for the day — **simulated** |
| Unlimited | **$5.99 once** | No daily limit, no ads, no timer — **real Stripe Checkout** |
| Hint pack | $1.99 | 10 hints, consumable — **simulated**, no link wired |

State lives in `localStorage` under `scripturehunt.v1`.

### How the Stripe purchase works

`STRIPE.unlimited` in `index.html` points at a Stripe Payment Link. Clicking Unlock hands the
browser to Stripe; on success Stripe redirects to `https://scripture-hunt.pages.dev/?paid=1`,
which sets `unlimited = true` and then strips the query with `history.replaceState` so a reload
does not re-trigger and the URL stays shareable.

**This is not a payment system.** A redirect is not proof of payment: anyone can open `/?paid=1`
and unlock for free. That is acceptable for a demo on a link you hand out yourself, and
unacceptable for money you intend to keep. To make it real:

1. Add a `checkout.session.completed` webhook (needs a backend or a Cloudflare Worker).
2. Mint a signed entitlement token (or store the purchase keyed to an account/email).
3. Have the client ask the server before unlocking — never trust the query string.

Client-side unlocking is deliberately left in place so the flow can be demoed without a backend;
the code that must change is one function, `consumePaymentReturn()`.

## PWA

Installable on iOS and Android: `manifest.json` with maskable icons, a service worker (`sw.js`)
that precaches the shell plus `data/puzzles.json` so the game plays offline, iOS
`apple-mobile-web-app-*` meta tags, and safe-area padding so a standalone launch on a notched
phone does not put the verse under the home indicator.

The service worker is best-effort: registration failure (private mode, old Safari) must never
break the game.

### Why this price shape, from measured competitor storefronts

- Every **game** in this category sells one-time unlocks and coin/hint packs, not subscriptions:
  `Bible Word Search` (97K ratings) — `No Ads Forever $5.99` + coins `$0.99-11.99`;
  `Lord's Word` (9.2K) — hint packs `$3.99-6.99` + `No Ads $5.99`;
  `Bible Word Puzzle` (724K) — coin bundles `$0.99-5.99`.
- Only the **tool** apps (`Bible Widgets` 128K, `Bible Mode` 12.8K) run subscriptions
  (`$4.99/wk`, `$35.99-59.99/yr`) — because they are opened daily out of habit. A puzzle you can
  finish is not that, so a subscription here would be cancelled in week one and earn a bad review.
- One outlier (`Bible Trivia`, 86K) does run a `$1.99` weekly on top of `$2.99` no-ads. Worth
  watching, but 1 of 4 measured games is not a pattern.

`lint` for this section: every path that hands out a verse must go through `spendPlay()`.

## Naming

Shipped as **Scripture Hunt**. The original working title `Scripture Search` collided with the two
installed leaders (`Bible Word Search` 97K, `Bible Word Puzzle` 724K) and with two tiny live apps
that already rank for that phrase (`Search The Scriptures` 38 ratings, `Scripture Search Quiz` 6).
`Hunt` also matches the actual mechanic (drag to find), which `Search` did not.

Domain candidates checked over RDAP (`.com`):

| Domain | Status |
|---|---|
| `scripturesearch.com` | taken (1999) |
| `biblewordgame.com` | taken (2005) |
| `versesearch.com` | taken (2018) |
| **`scripturehunt.com`** | **available** |
| `biblewordhunt.com` | available |

Prefer `scripturehunt.com`. Do not buy a domain to "own the brand" before the mechanic is
validated — App Store search, not SEO, is where these products get discovered
(`Bible Word Search` went 0 → 97K ratings in 9 months). Ship the landing page on a free
Cloudflare Pages / Firebase domain first; Apple accepts those for the support and privacy URLs.


## Data

Everything ships as static JSON, no backend.

- `data/puzzles.json` — 600 puzzles (~161 KB): `{ref, text, words[]}`. `words` are the hidden words, uppercase.
- `data/pool_final.json` — 2,685 verified playable words.
- `data/kjv/` — the 66-book King James Version source (`aruljohn/Bible-kjv`, MIT packaging of the public-domain KJV text).
- `data/corpus.json` — 31,102 verses + word frequencies (build artifact, not loaded by the game).

### Pipeline

```
data/fetch_kjv.py   -> data/kjv/*.json (66 books, 31,102 verses)
build step          -> data/corpus.json, data/pool_final.json, data/puzzles.json
```

The word pool was filtered by requiring each candidate to appear in `/usr/share/dict/web2`
(authoritative English dictionary, with inflection stemming). That drops the 493 proper nouns
and archaic forms (ABIJAH, ABISHAG, WENT-eth forms) that would otherwise be unguessable.

## Design constraints the build enforces

`python3 tools/check_puzzles.py` must exit 0. It asserts, for every puzzle:

1. Each declared word maps to **exactly one** clickable token in the verse — under the same
   tokenizer the browser uses (`/[A-Za-z]+(?:['’][A-Za-z]+)?/g`). This is what keeps a puzzle
   from being impossible to complete.
2. No duplicate entries in `words[]`.
3. Word count is within 5-14.
4. Every word is in the verified pool.
5. **At least 30% of a verse's content words (4+ letters, non-function) stay as distractors.**
   Without this the game degrades into "click every word that looks like a noun".

Bugs and design faults this process caught:

- **Words repeated in a verse.** `2 Samuel 11:13` lists `WENT` twice; finding one occurrence
  marked the shared token found and the counter could never reach the target. Words are now
  only hidden if they occur exactly once in the verse.
- **Possessives.** `harlot’s`, `father’s`, `name’s` — the tokenizer keeps the `’s`, so a declared
  `HARLOT` never matched. Only bare words (no `'` or `’`) are eligible now.
- **Non-hidden words were not clickable.** Originally only the hidden words got a `<span>`, so
  ordinary words could not be clicked at all and a wrong guess produced *no feedback* — the
  player had no way to tell a hidden word from a plain one and was guessing blind. Now every
  word is a target and a wrong guess flashes red with a message.
- **Almost no distractors.** The first generator hid *every* pool word in a verse (64% of content
  words on average, 93 puzzles above 80%). Playing it, the correct words were simply "the nouns",
  so clicking each content word scored 100%. Hiding 40-65% of content words brings that strategy
  down to 45-63% accuracy.


## Why this exists

Market research (`../research/religion-app-category-gaps-2026-11.md`) found the Bible
puzzle/trivia shape has the highest observed success rate in the category (8.2% of such apps
reach 5,000+ ratings, vs 2.7% for short-video). Four winners launched in 2025 —
`Bible Word Search` 97,545 ratings, `Bible Solitaire` 86,776, `Bible Trivia` 86,472,
`Bible Tiles` 22,225. This prototype tests whether the *find-the-word-inside-real-scripture*
mechanic is actually fun, before building anything native.

The bet this validates: people who read the Bible daily already re-read the same verses, so
hunting words inside familiar text is a warm, low-friction loop — not a vocabulary quiz.
