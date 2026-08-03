"""Fetch a free BlenderKit asset by its asset_base_id, or search for one.

  python tools/fetch_blenderkit.py <asset_base_id> [--type blend|gltf] [--out PATH]
  python tools/fetch_blenderkit.py --search "chest" [--limit 10]

Free assets download anonymously: the search API lists the files, the downloads
endpoint hands back a presigned URL (it wants a scene_uuid, any UUID works).
Default output is assets/props/source/<slug>.<ext>. Paid assets have no
anonymous presign and will fail here; that is intentional.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://www.blenderkit.com/api/v1"
EXT = {"blend": ".blend", "gltf": ".glb", "gltf_godot": ".glb", "resolution_2K": ".blend"}


# The assets CDN 403s the default urllib agent; the API does not care.
HEADERS = {"User-Agent": "Blender/5.2 BlenderKit/fetch"}


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS))


def get_json(url):
    with request(url) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("asset_base_id", nargs="?")
    ap.add_argument("--type", default="blend", help="fileType to fetch (blend, gltf, ...)")
    ap.add_argument("--out", default=None, help="output path (default assets/props/source/<slug>)")
    ap.add_argument("--search", default=None, help="list free models matching this text instead of fetching")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    if args.search:
        q = args.search.replace(" ", "+") + "+asset_type:model+is_free:true+order:_score"
        data = get_json(f"{API}/search/?query={q}&page_size={args.limit}")
        print(f"{data['count']} free models; top {min(args.limit, data['count'])}:")
        for a in data["results"]:
            blend = next((f for f in a["files"] if f["fileType"] == "blend"), None)
            size = f"{(blend['fileUploadSize'] or 0) / 1e6:.1f}MB" if blend else "no blend"
            variants = sorted({f["fileType"] for f in a["files"] if f["fileType"].startswith("resolution")})
            print(f"  {a['assetBaseId']}  {a['name']}  [{a['license']}, {size}"
                  + (f", small: {', '.join(variants)}" if variants else "") + "]")
        return
    if not args.asset_base_id:
        ap.error("asset_base_id required unless --search is given")

    data = get_json(f"{API}/search/?query=asset_base_id:{args.asset_base_id}")
    if not data.get("results"):
        sys.exit("asset not found: " + args.asset_base_id)
    asset = data["results"][0]
    if not asset.get("isFree"):
        sys.exit(f"'{asset['name']}' is not free; this tool only fetches free assets")

    files = {f["fileType"]: f for f in asset["files"] if not f.get("isThumbnail")}
    entry = files.get(args.type)
    if entry is None:
        sys.exit(f"no '{args.type}' file; available: {', '.join(sorted(files))}")

    presign = get_json(f"{API}/downloads/{entry['id']}/?scene_uuid={uuid.uuid4()}")
    file_url = presign.get("filePath")
    if not file_url:
        sys.exit("no filePath in download response: " + json.dumps(presign)[:300])

    out = args.out
    if out is None:
        slug = re.sub(r"[^a-z0-9]+", "_", asset["name"].lower()).strip("_")
        out = os.path.join(ROOT, "assets", "props", "source", slug + EXT.get(args.type, ""))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with request(file_url) as r, open(out, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    print(f"{asset['name']} ({asset['license']}, by {asset['author']['fullName'].strip()})")
    print("wrote", out, os.path.getsize(out), "bytes")


main()
