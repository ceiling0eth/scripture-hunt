"""Self-check for data/puzzles.json and the game's rendering contract.

Guarantees every puzzle is completable in the browser: each declared word must map to
exactly one clickable token, using the SAME tokenizer rule the game uses.

Run: python3 tools/check_puzzles.py
"""
import json, re, collections, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_RE = re.compile(r"([A-Za-z]+(?:['’][A-Za-z]+)?)")   # must match index.html buildTokens()

MIN_WORDS, MAX_WORDS = 5, 14
# A puzzle that hides most of its content words is not a puzzle: the player can just click everything
# that reads like a noun. Keep at least this share of content words as genuine distractors.
MIN_DISTRACTOR_SHARE = 0.30

FUNCTION_WORDS = set("""THE AND OF TO THAT IN HE SHALL UNTO FOR I HIS A LORD THEY THEM WITH THOU SAID HAVE
WILL THEE FROM WHEN THIS WERE UPON KING HATH WHICH THEIR THERE HOUSE SHALT SAITH EVERY THESE AFTER EARTH
GREAT THINE AMONG FORTH ALL WAS HIM HER SHE IT BE IS ARE AS AT BY OR BUT NOT THEN THAN SO IF DO DID DONE
MAY MIGHT MUST CAN COULD WOULD SHOULD BEEN BEING HAD HAS HAST YEA NAY ALSO EVEN YET NOW WHAT WHOM WHOSE
THOSE HERE WHERE WHY HOW MINE THINE HIMSELF HERSELF ITSELF YOURS THEIR AGAIN INTO""".split())


def content_words(text):
    """Words a player would treat as 'clickable-looking': 4+ letters, not a function word."""
    out = []
    for m in TOKEN_RE.finditer(text):
        w = m.group(0)
        if len(w) >= 4 and w.upper() not in FUNCTION_WORDS:
            out.append(w.upper())
    return out


def main() -> int:
    puzzles = json.load(open(os.path.join(ROOT, "data", "puzzles.json")))
    pool = set(json.load(open(os.path.join(ROOT, "data", "pool_final.json"))))
    failures, thin = [], []

    for p in puzzles:
        hidden = set(p["words"])

        # Rule 1: each declared word must tag exactly one token (else the puzzle cannot be finished).
        tagged = collections.Counter()
        for m in TOKEN_RE.finditer(p["text"]):
            u = m.group(0).upper().replace("’", "'")
            if u in hidden:
                tagged[u] += 1
        for w in p["words"]:
            if tagged[w] != 1:
                failures.append((p["ref"], w, f"tagged {tagged[w]}x, need exactly 1"))
            if w not in pool:
                failures.append((p["ref"], w, "not in verified word pool"))

        # Rule 2: no duplicate entries.
        if len(p["words"]) != len(set(p["words"])):
            failures.append((p["ref"], "DUP", "duplicate entries"))

        # Rule 3: playable size.
        if not MIN_WORDS <= len(p["words"]) <= MAX_WORDS:
            failures.append((p["ref"], "COUNT", f'{len(p["words"])} words'))

        # Rule 4: enough distractors that the player must actually discriminate.
        uniq = set(content_words(p["text"]))
        if uniq:
            share = len(hidden & uniq) / len(uniq)
            if 1 - share < MIN_DISTRACTOR_SHARE:
                thin.append((p["ref"], f"only {1-share:.0%} of content words are distractors"))

    print(f"puzzles: {len(puzzles)}  failures: {len(failures)}  too-easy: {len(thin)}")
    for f in failures[:10]:
        print("  FAIL", f)
    for t in thin[:5]:
        print("  EASY", t)

    if failures:
        print("FAIL")
        return 1
    if thin:
        print(f"WARN - {len(thin)} puzzles hide most content words; game degrades to click-everything")
    print("OK - every puzzle is completable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
