"""Resumable parallel downloader for to_download.json (HF auth, Range resume)."""
import json, os, sys, time, urllib.request, concurrent.futures as cf

MODELS = r"C:\Users\defie\ComfyUI-Shared\models"
TOKEN = open(os.path.expanduser("~/.cache/huggingface/token")).read().strip()
HERE = os.path.dirname(os.path.abspath(__file__))

# Deferred for disk space (see README): Wan 14B T2V, Qwen edit; LTX is gated.
SKIP_SUBSTR = ["wan2.2_t2v_", "qwen_image_edit_2511", "Qwen-Image-Edit-2511", "ltx-2.5", "gemma4", "umt5_xxl"]


def fetch(item):
    dest = os.path.join(MODELS, item["dir"], item["name"])
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    size = item["size"]
    if os.path.exists(dest) and os.path.getsize(dest) == size:
        return f"have {item['name']}"
    for attempt in range(8):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if have >= size:
            break
        req = urllib.request.Request(item["url"], headers={"Authorization": f"Bearer {TOKEN}", "Range": f"bytes={have}-"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(part, "ab") as f:
                while True:
                    chunk = r.read(8 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
        except Exception as e:  # noqa: BLE001
            print(f"retry {attempt} {item['name']}: {e}", flush=True)
            time.sleep(5 * (attempt + 1))
    if os.path.getsize(part) != size:
        return f"FAILED {item['name']} ({os.path.getsize(part)}/{size})"
    os.replace(part, dest)
    return f"done {item['name']} {size/2**30:.1f}G"


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    items = [i for i in json.load(open(os.path.join(HERE, "to_download.json")))
             if (only and only in i["name"]) or (not only and not any(s in i["name"] for s in SKIP_SUBSTR))]
    if only == "ltx-2.5":  # LTX also needs its Gemma text encoder
        items += [i for i in json.load(open(os.path.join(HERE, "to_download.json"))) if "gemma4" in i["name"]]
    items = list({i["name"]: i for i in items}.values())  # dedupe (never fetch one file twice in parallel)
    total = sum(i["size"] for i in items)
    print(f"{len(items)} files, {total/2**30:.1f} GiB", flush=True)
    # Small files first so whole models become usable as early as possible.
    items.sort(key=lambda i: i["size"])
    with cf.ThreadPoolExecutor(4) as ex:
        for msg in ex.map(fetch, items):
            print(msg, flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
