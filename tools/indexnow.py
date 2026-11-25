"""Submit URLs to Bing/Yandex via the IndexNow protocol.

IndexNow needs no account: you publish a key file at the site root, then POST a JSON body
naming up to 10,000 URLs. Bing treats the ping as a crawl hint, which is the fastest signal
available without a Webmaster Tools login.

    python3 tools/indexnow.py            # submit sitemap URL and the homepage
    python3 tools/indexnow.py --all      # submit all 600 verse URLs (Bing's limit is 10k/day)

The key file must be deployed before the first submission or the ping is rejected with 403.
"""
import json, os, re, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://scripturehunt.com"
ENDPOINT = "https://api.indexnow.org/indexnow"


def find_key():
    """The key is the name of the <key>.txt file we publish at the site root."""
    for name in os.listdir(ROOT):
        if re.fullmatch(r"[0-9a-f]{32}\.txt", name):
            return name[:-4]
    sys.exit("no IndexNow key file found; expected a 32-hex-character .txt at the repo root")


def urls_from_sitemap():
    path = os.path.join(ROOT, "sitemap.xml")
    with open(path, encoding="utf-8") as f:
        return re.findall(r"<loc>([^<]+)</loc>", f.read())


def submit(urls, key, dry_run=False):
    host = SITE.split("//", 1)[1]
    body = {
        "host": host,
        "key": key,
        "keyLocation": f"{SITE}/{key}.txt",
        "urlList": urls,
    }
    if dry_run:
        print(f"[dry-run] would POST {len(urls)} urls to {ENDPOINT}")
        print(json.dumps(body, indent=1)[:400])
        return 0

    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"HTTP {r.status} for {len(urls)} urls")
            return 0 if r.status in (200, 202) else 1
    except urllib.error.HTTPError as e:
        # 403 = key file not reachable yet; 422 = some URLs invalid; both are visible, not silent.
        detail = e.read()[:300].decode("utf-8", "ignore")
        print(f"HTTP {e.code}: {detail}")
        return 1


def main():
    key = find_key()
    verbose = "--all" in sys.argv
    dry = "--dry-run" in sys.argv
    urls = urls_from_sitemap() if verbose else [f"{SITE}/", f"{SITE}/verses/"]
    print(f"key={key} mode={'all' if verbose else 'entry-points'} urls={len(urls)}")
    return submit(urls, key, dry_run=dry)


if __name__ == "__main__":
    sys.exit(main())
