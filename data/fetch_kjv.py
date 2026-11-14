"""Download KJV (public domain text, MIT-licensed JSON packaging) from aruljohn/Bible-kjv."""
import json, os, urllib.request, time, sys

BASE = "https://raw.githubusercontent.com/aruljohn/Bible-kjv/master/"
BOOKS = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
 "1Samuel","2Samuel","1Kings","2Kings","1Chronicles","2Chronicles","Ezra","Nehemiah","Esther",
 "Job","Psalms","Proverbs","Ecclesiastes","SongofSolomon","Isaiah","Jeremiah","Lamentations",
 "Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk",
 "Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts","Romans",
 "1Corinthians","2Corinthians","Galatians","Ephesians","Philippians","Colossians",
 "1Thessalonians","2Thessalonians","1Timothy","2Timothy","Titus","Philemon","Hebrews","James",
 "1Peter","2Peter","1John","2John","3John","Jude","Revelation"]

def main():
    os.makedirs("kjv", exist_ok=True)
    for i, b in enumerate(BOOKS, 1):
        path = f"kjv/{b}.json"
        if os.path.exists(path) and os.path.getsize(path) > 100:
            continue
        for attempt in range(3):
            try:
                with urllib.request.urlopen(BASE + b + ".json", timeout=25) as r:
                    data = r.read()
                json.loads(data)          # validate before writing
                open(path, "wb").write(data)
                break
            except Exception as e:
                if attempt == 2: print("FAIL", b, e, file=sys.stderr)
                time.sleep(2)
        print(f"{i}/{len(BOOKS)} {b}", flush=True)
        time.sleep(0.2)

if __name__ == "__main__":
    main()
