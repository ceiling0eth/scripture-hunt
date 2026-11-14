"""Build data/pool_final.json and data/puzzles.json from the downloaded KJV.

    python3 data/fetch_kjv.py      # once: downloads data/kjv/*.json (66 books)
    python3 tools/build_puzzles.py # builds corpus, word pool, and the puzzle set

Deterministic: same seed, same output. The word pool is validated against Webster's 2nd
(/usr/share/dict/web2), which drops proper nouns and archaic forms a player could never guess.
"""
import json, re, os, collections, random, statistics, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TOKEN_RE = re.compile(r"([A-Za-z]+(?:['’][A-Za-z]+)?)")
DICT = "/usr/share/dict/web2"

# Words every verse uses; never interesting as a hidden word.
STOP = set("""THE AND OF TO THAT IN HE SHALL UNTO FOR I HIS A LORD THEY THEM WITH THOU SAID HAVE WILL THEE
FROM WHEN THIS WERE UPON KING HATH WHICH THEIR THERE HOUSE SHALT SAITH EVERY THESE AFTER EARTH GREAT THINE
AMONG FORTH ALL WAS HIM HER SHE IT BE IS ARE AS AT BY OR BUT NOT THEN THAN SO IF DO DID DONE MAY MIGHT MUST
CAN COULD WOULD SHOULD BEEN BEING HAD HAS HAST YEA NAY ALSO EVEN YET NOW WHEREFORE WHEREUPON THEREFORE
WHEREIN WHEREON WHEREBY HEREBY THEREBY ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN HUNDRED THOUSAND
THIRTY FORTY FIFTY TWENTY MINE THINE THYSELF HIMSELF HERSELF ITSELF YOURS THEIRS WHAT WHOM WHOSE THIS THOSE
HERE WHERE WHY HOW UPON AGAIN INTO""".split())

FUNCTION_WORDS = STOP  # reused by the distractor-share check below

PROPER = set("""ISRAEL JUDAH DAVID MOSES JESUS CHRIST JACOB ABRAHAM JOSEPH EGYPT BABYLON JERUSALEM SAMUEL
SAUL SOLOMON ELIJAH ELISHA ISAAC ESAU AARON JOSHUA GIDEON SAMSON RUTH NAOMI BOAZ DANIEL JONAH HOSEA JOEL AMOS
OBADIAH MICAH NAHUM HABAKKUK ZEPHANIAH HAGGAI ZECHARIAH MALACHI MATTHEW MARK LUKE JOHN PETER PAUL JAMES JUDE
TIMOTHY TITUS PHILEMON HEBREWS ROMANS GALATIANS EPHESIANS PHILIPPIANS COLOSSIANS THESSALONIANS CORINTHIANS""".split())

PUZZLE_COUNT = 600
MIN_WORDS, MAX_WORDS = 5, 8
SEED = 23


def load_verses():
    books = sorted(f for f in os.listdir(os.path.join(DATA, "kjv")) if f.endswith(".json"))
    if not books:
        sys.exit("data/kjv is empty — run data/fetch_kjv.py first")
    verses = []
    for f in books:
        d = json.load(open(os.path.join(DATA, "kjv", f)))
        for ch in d["chapters"]:
            for v in ch["verses"]:
                verses.append({"b": d["book"], "c": int(ch["chapter"]), "v": int(v["verse"]), "t": v["text"]})
    return verses


def dictionary_words():
    if not os.path.exists(DICT):
        sys.exit(f"missing {DICT} — the word-pool filter needs a system English dictionary")
    return {line.strip().lower() for line in open(DICT, encoding="utf-8", errors="ignore") if line.strip()}


def in_dictionary(word, web2):
    """web2 omits regular inflections, so accept an inflected form whose stem is listed."""
    lw = word.lower()
    if lw in web2:
        return True
    for suf in ("s", "es", "ed", "d", "ing", "ly", "ness", "er", "est", "ion"):
        if lw.endswith(suf):
            base = lw[: -len(suf)]
            if len(base) >= 3 and (base in web2 or base + "e" in web2):
                return True
            if len(base) >= 2 and base + base[-1] in web2:
                return True
    return False


def build_corpus(verses):
    wfreq = collections.Counter()
    for v in verses:
        for w in TOKEN_RE.finditer(v["t"]):
            wfreq[w.group(0).upper()] += 1
    return wfreq


def build_pool(wfreq, web2):
    pool = []
    for w, c in wfreq.items():
        if not (4 <= len(w) <= 7) or c < 5 or w in STOP or w in PROPER:
            continue
        if re.search(r"(ETH|EST|EDST)$", w) and len(w) >= 6:
            continue                                   # archaic verb forms
        if not in_dictionary(w, web2):
            continue                                   # proper nouns / dead words
        pool.append(w)
    return sorted(pool, key=lambda w: (-wfreq[w], w))


def is_content(tok):
    return len(tok) >= 4 and tok not in FUNCTION_WORDS


def build_puzzles(verses, pool_set, wfreq):
    rng = random.Random(SEED)
    rows = []
    for v in verses:
        toks = [m.group(0) for m in TOKEN_RE.finditer(v["t"])]
        if not (24 <= len(toks) <= 55):
            continue
        bare = [t for t in toks if "'" not in t and "’" not in t]
        cnt = collections.Counter(t.upper() for t in bare)
        content = list(dict.fromkeys(t.upper() for t in bare if is_content(t.upper())))
        if len(content) < 6:
            continue
        # A word is eligible only if it occurs exactly once: a repeated word would tag two tokens
        # and the counter could never be completed.
        cand = [w for w in content if cnt[w] == 1 and w in pool_set]
        if len(cand) < MIN_WORDS:
            continue
        target = max(MIN_WORDS, min(MAX_WORDS, round(len(content) * rng.uniform(0.40, 0.65))))
        target = min(target, len(cand))
        if target < MIN_WORDS:
            continue
        chosen = sorted(cand, key=lambda w: (-wfreq[w], w))[:target]
        # Keep enough ordinary words as distractors that the player must discriminate.
        if 1 - len(chosen) / len(content) < 0.30:
            continue
        rows.append({"ref": f"{v['b']} {v['c']}:{v['v']}", "text": v["t"], "words": sorted(chosen),
                     "_r": len(chosen) / len(content)})

    rows.sort(key=lambda r: r["_r"])
    step = max(1, len(rows) // PUZZLE_COUNT)
    sel = rows[::step][:PUZZLE_COUNT]
    random.Random(SEED + 2).shuffle(sel)
    return [{k: r[k] for k in ("ref", "text", "words")} for r in sel], rows


def main():
    verses = load_verses()
    web2 = dictionary_words()
    wfreq = build_corpus(verses)
    pool = build_pool(wfreq, web2)
    puzzles, all_rows = build_puzzles(verses, set(pool), wfreq)

    json.dump(pool, open(os.path.join(DATA, "pool_final.json"), "w"))
    json.dump(puzzles, open(os.path.join(DATA, "puzzles.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    print(f"verses: {len(verses)}")
    print(f"word pool: {len(pool)} (from {len(wfreq)} distinct tokens, dictionary-verified)")
    print(f"eligible puzzles: {len(all_rows)} -> shipped {len(puzzles)}")
    print(f"words per puzzle: {statistics.mean(len(p['words']) for p in puzzles):.1f} avg")
    print(f"hidden share of content words: {statistics.mean(r['_r'] for r in all_rows)*100:.1f}%")


if __name__ == "__main__":
    main()
