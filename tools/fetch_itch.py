"""Download the free ("name your own price") uploads of an itch.io asset pack.

    python tools/fetch_itch.py quaternius modular-character-outfits-fantasy \
        --out assets/props/source/quaternius_outfits

itch grants an anonymous session a download key, then hands out a signed file URL
per upload. Both steps need the page's csrf token and the same cookie jar, so this
does the whole flow in one process. Paid uploads simply do not appear in the list.
"""

import argparse
import json
import os
import re
import sys
import urllib.parse

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"


def csrf(html: str) -> str:
    m = re.search(r'csrf_token"\s+value="([^"]+)"', html)
    if not m:
        sys.exit("no csrf token on the page (itch changed its markup?)")
    return m.group(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("user")
    ap.add_argument("slug")
    ap.add_argument("--out", required=True)
    ap.add_argument("--list", action="store_true", help="show the uploads and stop")
    args = ap.parse_args()

    base = f"https://{args.user}.itch.io/{args.slug}"
    s = requests.Session()
    s.headers["User-Agent"] = UA

    page = s.get(base, timeout=60).text
    token = csrf(page)

    r = s.post(
        f"{base}/download_url",
        json={"csrf_token": token},
        headers={"Referer": base},
        timeout=60,
    )
    r.raise_for_status()
    grant = r.json()["url"]

    dl = s.get(grant, timeout=60)
    dl.raise_for_status()
    html = dl.text
    # The grant lives in the session cookie from here on; /file/ hangs off the pack
    # page and takes the DOWNLOAD page's csrf, not the pack page's.
    token = csrf(html)

    uploads = []
    for m in re.finditer(r'upload_id="(\d+)"', html):
        uid = m.group(1)
        after = html[m.end():m.end() + 4000]
        name = re.search(
            r'class="name" title="([^"]+)"|title="([^"]+)" class="name"', after
        )
        uploads.append((uid, (name.group(1) or name.group(2)) if name else f"{uid}.zip"))
    if not uploads:
        sys.exit("no free uploads on this page")

    for uid, name in uploads:
        print(f"{uid}  {name}")
    if args.list:
        return

    os.makedirs(args.out, exist_ok=True)
    key = urllib.parse.urlparse(grant).path.rsplit("/", 1)[-1]
    for uid, name in uploads:
        r = s.post(
            f"{base}/file/{uid}?source=game_download",
            data={"csrf_token": token},
            headers={"Referer": base},
            timeout=60,
        )
        r.raise_for_status()
        url = r.json()["url"]
        dest = os.path.join(args.out, name)
        print(f"-> {dest}")
        with s.get(url, stream=True, timeout=600) as f:
            f.raise_for_status()
            with open(dest, "wb") as out:
                for chunk in f.iter_content(1 << 20):
                    out.write(chunk)
        print(f"   {os.path.getsize(dest) / 1e6:.1f} MB")
    _ = key


if __name__ == "__main__":
    main()
