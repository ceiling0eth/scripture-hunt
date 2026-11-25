"""Generate one static, crawlable page per puzzle at /v/<slug>/index.html.

Why: the app itself is a single HTML file that shows a random verse, so a search engine sees one
page with no content. Every verse the game can serve is already in data/puzzles.json, so each one
becomes a real page with the verse text on it — 600 entry points that can rank for long-tail
queries like "Psalm 23 word search" without needing any backlinks.

Run: python3 tools/build_verse_pages.py
"""
import json, os, re, html, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "v")
SITE = "https://scripturehunt.com"

# Book name -> the same book with hyphens for the slug / URL.
# Sent on every generated page. A visitor who lands on the old *.pages.dev hostname is moved to
# the canonical domain so both hosts never compete in the index. Kept inline and tiny: no extra
# request, and the canonical link above still tells a crawler the right answer without running JS.
REDIRECT = (
    '<script>(function(){if(location.hostname==="scripture-hunt.pages.dev"){'
    'location.replace("https://scripturehunt.com"+location.pathname+location.search);}})();</script>'
)


def slugify(ref):
    s = ref.lower().replace(":", "-").replace(" ", "-")
    return re.sub(r"[^a-z0-9-]", "", s)


def load():
    puzzles = json.load(open(os.path.join(DATA, "puzzles.json")))
    # Stable order for prev/next links, and a deterministic sitemap.
    puzzles.sort(key=lambda p: p["ref"])
    return puzzles


def page_html(p, prev_p, next_p, index):
    ref = p["ref"]
    title = f"{ref} — Scripture Hunt"
    desc = f"Find {len(p['words'])} hidden words in {ref}. A free Bible word-hunt puzzle, playable in the browser."
    words_html = ", ".join(f"<code>{html.escape(w)}</code>" for w in p["words"])
    nav = []
    if prev_p:
        nav.append(f'<a href="/v/{slugify(prev_p["ref"])}/">&larr; {html.escape(prev_p["ref"])}</a>')
    nav.append('<a href="/">Play a random verse</a>')
    if next_p:
        nav.append(f'<a href="/v/{slugify(next_p["ref"])}/">{html.escape(next_p["ref"])} &rarr;</a>')

    # Structured data so the page is understood as a game, not an article.
    ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "Game",
        "name": f"Scripture Hunt — {ref}",
        "description": desc,
        "url": f"{SITE}/v/{slugify(ref)}/",
        "isAccessibleForFree": True,
        "gameLocation": f"{SITE}/v/{slugify(ref)}/",
        "inLanguage": "en",
    }, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{SITE}/v/{slugify(ref)}/">\n{REDIRECT}
<meta name="theme-color" content="#12100e">
<meta property="og:title" content="{html.escape(ref)} — Scripture Hunt">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}/v/{slugify(ref)}/">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
  :root{{--bg:#12100e;--panel:#1c1917;--ink:#f5f1e8;--muted:#a8a29e;--gold:#d4a94e;--gold-dim:#8a6d33;--line:#3f3a35;}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--ink);
    font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;line-height:1.7;
    padding:24px 16px calc(24px + env(safe-area-inset-bottom));}}
  .wrap{{max-width:680px;margin:0 auto}}
  a{{color:var(--gold);text-decoration:none}} a:hover{{text-decoration:underline}}
  h1{{font-size:20px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-dim);
     font-weight:600;margin:0 0 4px}}
  .verse{{background:var(--panel);border:1px solid var(--line);border-radius:10px;
          padding:20px;font-size:19px;margin:16px 0}}
  .words{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}}
  .words h2{{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;font-weight:600}}
  code{{background:#0d0c0b;border:1px solid var(--line);border-radius:4px;padding:2px 7px;
        margin:0 4px 6px 0;display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:13px}}
  .cta{{display:inline-block;background:var(--gold);color:#12100e;font-weight:600;
        padding:12px 22px;border-radius:8px;margin:8px 0 20px}}
  .cta:hover{{text-decoration:none;background:#e5bb5f}}
  nav{{display:flex;gap:18px;flex-wrap:wrap;border-top:1px solid var(--line);
       padding-top:16px;margin-top:24px;font-size:14px}}
  .note{{color:var(--muted);font-size:13px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>Scripture Hunt</h1>
  <p class="note">A Bible word hunt — find the words hidden in the verse.</p>

  <h2 style="font-size:15px;color:var(--muted);font-weight:600;margin:20px 0 0">{html.escape(ref)}</h2>
  <div class="verse">{html.escape(p["text"])}</div>

  <div class="words">
    <h2>Words hidden in this verse</h2>
    <p>{words_html}</p>
  </div>

  <a class="cta" href="/?verse={slugify(ref)}">Play this verse &rarr;</a>
  <p class="note">Drag across a word to find it. Three verses free every day, or unlock the
    whole thing for $1.99.</p>

  <nav>
    {"".join(f"<span>{n}</span>" for n in nav)}
  </nav>
  <p class="note" style="margin-top:18px">King James Version, public domain.</p>
</div>
<script type="application/ld+json">{ld}</script>
</body>
</html>
"""


def build_sitemap(puzzles):
    urls = [f"  <url><loc>{SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>"]
    for p in puzzles:
        urls.append(
            f"  <url><loc>{SITE}/v/{slugify(p['ref'])}/</loc>"
            f"<changefreq>monthly</changefreq><priority>0.6</priority></url>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n</urlset>\n"
    )


def build_index(puzzles):
    """A single crawlable page listing every verse, grouped by book.

    The sitemap was submitted to Google on 2026-11-16 and never read: eight days later the
    property still reported "could not fetch" and the verse pages reported "no referring sitemap
    detected". A live fetch test proved the file itself is fine, so the crawl has to come from
    links instead: the homepage links here, this page links to all 600 verses, and each verse links
    to its neighbours. That path does not depend on the sitemap being processed at all.
    """
    groups = {}
    for p in puzzles:
        # "1 Chronicles 15:28" -> book "1 Chronicles"; "Psalms 23:1" -> "Psalms"
        book = re.sub(r"\s+\d+:\d+$", "", p["ref"])
        groups.setdefault(book, []).append(p)

    def book_key(name):
        m = re.match(r"^(\d?)\s*(.*)$", name)
        return (int(m.group(1)) if m.group(1) else 99, m.group(2))

    sections = []
    for book in sorted(groups, key=book_key):
        items = "".join(
            f'<li><a href="/v/{slugify(p["ref"])}/">{html.escape(p["ref"])}</a></li>'
            for p in groups[book]
        )
        sections.append(
            f'<section><h2>{html.escape(book)} <span class="n">{len(groups[book])}</span></h2>'
            f"<ul>{items}</ul></section>"
        )

    title = f"All {len(puzzles)} Bible word-hunt verses — Scripture Hunt"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="Every Bible verse in Scripture Hunt, grouped by book. Pick a passage and find the words hidden inside it.">
<link rel="canonical" href="{SITE}/verses/">\n{REDIRECT}
<meta name="theme-color" content="#12100e">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<style>
  :root{{--bg:#12100e;--panel:#1c1917;--ink:#f5f1e8;--muted:#a8a29e;--gold:#d4a94e;--gold-dim:#8a6d33;--line:#3f3a35;}}
  *{{box-sizing:border-box}}
  body{{margin:0;background:var(--bg);color:var(--ink);
    font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;line-height:1.6;
    padding:24px 16px calc(24px + env(safe-area-inset-bottom));}}
  .wrap{{max-width:820px;margin:0 auto}}
  h1{{font-size:19px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin:0 0 4px}}
  .note{{color:var(--muted);font-size:14px;margin:0 0 24px}}
  a{{color:var(--ink);text-decoration:none}} a:hover{{color:var(--gold);text-decoration:underline}}
  .home{{color:var(--gold);display:inline-block;margin-bottom:20px;font-size:14px}}
  section{{border-top:1px solid var(--line);padding:14px 0}}
  h2{{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-dim);
     margin:0 0 10px;font-weight:600}}
  h2 .n{{color:var(--muted);font-weight:400;letter-spacing:0}}
  ul{{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px 16px}}
  li{{font-size:15px}}
</style>
</head>
<body>
<div class="wrap">
  <a class="home" href="/">&larr; Play Scripture Hunt</a>
  <h1>All verses</h1>
  <p class="note">{len(puzzles)} passages, grouped by book. Pick one and find the words hidden inside it.</p>
  {"".join(sections)}
</div>
</body>
</html>
"""


def main():
    puzzles = load()
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    for i, p in enumerate(puzzles):
        prev_p = puzzles[i - 1] if i > 0 else None
        next_p = puzzles[i + 1] if i < len(puzzles) - 1 else None
        d = os.path.join(OUT, slugify(p["ref"]))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page_html(p, prev_p, next_p, i))

    # The crawl path that does not depend on the sitemap.
    idx = os.path.join(ROOT, "verses")
    os.makedirs(idx, exist_ok=True)
    with open(os.path.join(idx, "index.html"), "w", encoding="utf-8") as f:
        f.write(build_index(puzzles))

    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(build_sitemap(puzzles))

    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")

    print(f"generated {len(puzzles)} verse pages in v/")
    print("generated verses/index.html (crawl entry point)")
    print(f"sitemap.xml with {len(puzzles) + 1} urls")


if __name__ == "__main__":
    main()
