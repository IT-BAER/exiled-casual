"""Generate a mesh with Tripo3D (https://tripo3d.ai) and drop the glb into assets/.

  python tools/fetch_tripo3d.py --text "a weathered oak barrel, game asset"
  python tools/fetch_tripo3d.py --image concept.png --out assets/props/source/barrel.glb
  python tools/fetch_tripo3d.py --balance

BlenderKit stays FIRST (tools/fetch_blenderkit.py): a scanned asset is real
geometry with real texels, and this is the fallback for when nothing there
matches. What comes back is a generated scan-alike, so it lands in
assets/props/source/ and still goes through build_props.py to be decimated to
budget like any other source.

The key is read from TRIPO_API_KEY, or from a TRIPO_API_KEY= line in the repo's
.env (gitignored). It is never printed, and never passed on a command line.
"""
import argparse
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.tripo3d.ai/v2/openapi"
POLL_SECONDS = 3
# Tripo hands back a presigned URL; it does not live long, so download at once.
TERMINAL = {"success", "failed", "cancelled", "banned", "expired", "unknown"}


def api_key():
    key = os.environ.get("TRIPO_API_KEY", "").strip()
    if not key:
        try:
            with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
                for line in f:
                    name, _, value = line.partition("=")
                    if name.strip() == "TRIPO_API_KEY":
                        key = value.strip().strip("'\"")
        except OSError:
            pass
    if not key:
        sys.exit("no TRIPO_API_KEY: set the env var, or put TRIPO_API_KEY=... in .env "
                 "(get one at https://platform.tripo3d.ai/api-keys)")
    return key


def call(path, body=None, data=None, headers=None):
    req = urllib.request.Request(
        f"{API}/{path}",
        data=json.dumps(body).encode() if body is not None else data,
        headers={"Authorization": f"Bearer {api_key()}", **(headers or {})},
    )
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        # The body carries Tripo's own reason; a traceback carries none of it.
        sys.exit(f"HTTP {e.code} from /{path}: {e.read().decode('utf-8', 'replace')[:300]}")
    if out.get("code") not in (0, None):
        sys.exit(f"tripo error {out.get('code')}: {out.get('message', out)}")
    return out.get("data", out)


def upload(path):
    """Multipart by hand: the rest of tools/ is stdlib-only, and this is 12 lines."""
    boundary = "----exiled" + os.urandom(8).hex()
    name = os.path.basename(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        blob = f.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode() + blob + f"\r\n--{boundary}--\r\n".encode()
    data = call("upload", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    token = data.get("image_token") or data.get("file_token")
    if not token:
        sys.exit("upload returned no token: " + json.dumps(data)[:300])
    return token, os.path.splitext(name)[1].lstrip(".").lower().replace("jpeg", "jpg")


def wait(task_id):
    last = None
    while True:
        data = call(f"task/{task_id}")
        status, progress = data.get("status"), data.get("progress", 0)
        if (status, progress) != last:
            print(f"  {status} {progress}%")
            last = (status, progress)
        if status in TERMINAL:
            if status != "success":
                sys.exit(f"task {status}: {json.dumps(data)[:300]}")
            return data
        time.sleep(POLL_SECONDS)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "tripo"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", help="text prompt to model from")
    ap.add_argument("--image", help="local image path or http(s) URL to model from")
    ap.add_argument("--out", help="output path (default assets/props/source/<slug>.glb)")
    ap.add_argument("--face-limit", type=int, default=20000,
                    help="triangle budget asked of the generator; build_props.py decimates further")
    ap.add_argument("--style", help="e.g. person:person2cartoon, object:clay, object:steampunk")
    ap.add_argument("--model-version", default="v2.5-20250123")
    ap.add_argument("--no-pbr", action="store_true", help="take the plain textured model, not the PBR one")
    ap.add_argument("--balance", action="store_true", help="print remaining credits and exit")
    args = ap.parse_args()

    if args.balance:
        data = call("user/balance")
        print(f"balance: {data.get('balance')} (frozen {data.get('frozen')})")
        return
    if bool(args.text) == bool(args.image):
        ap.error("give exactly one of --text or --image")

    task = {
        "model_version": args.model_version,
        "face_limit": args.face_limit,
        "texture": True,
        "pbr": not args.no_pbr,
    }
    if args.style:
        task["style"] = args.style
    if args.text:
        task.update(type="text_to_model", prompt=args.text)
        name = slug(args.text)
    elif args.image.startswith("http"):
        task.update(type="image_to_model", image_url=args.image)
        name = slug(os.path.splitext(os.path.basename(args.image))[0])
    else:
        token, ext = upload(args.image)
        task.update(type="image_to_model", file={"type": ext, "file_token": token})
        name = slug(os.path.splitext(os.path.basename(args.image))[0])

    task_id = call("task", body=task)["task_id"]
    print(f"task {task_id}")
    output = wait(task_id).get("output", {})
    url = output.get("pbr_model") or output.get("model") or output.get("base_model")
    if not url:
        sys.exit("finished task carried no model: " + json.dumps(output)[:300])

    out = args.out or os.path.join(ROOT, "assets", "props", "source", f"{name}.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with urllib.request.urlopen(url) as r, open(out, "wb") as f:
        f.write(r.read())
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.1f}MB)")


if __name__ == "__main__":
    main()
