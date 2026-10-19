"""Resolve model files for chosen ComfyUI templates, report sizes, and download missing ones.

usage: python comfy_models.py plan|download
"""
import glob, json, os, sys, urllib.request, concurrent.futures as cf

SITE = r"C:\Users\defie\ComfyUI-Installs\ComfyUI\standalone-env\Lib\site-packages"
MODELS = r"C:\Users\defie\ComfyUI-Shared\models"
TEMPLATES = [
    "image_z_image_turbo",          # fast default image (Apache)
    "image_qwen_Image_2512",        # text-in-image / prompt adherence (Apache)
    "image_qwen_image_edit_2511",   # instruction edits
    "image_flux2_fp8",              # FLUX.2 [dev] fp8: top local quality
    "video_wan2_2_5B_ti2v",         # fast video t2v+i2v
    "video_wan2_2_14B_t2v",         # quality t2v
    "video_wan2_2_14B_i2v",         # quality i2v
    "video_ltx2_5_t2v",             # video + audio
    "video_ltx2_5_i2v",
]
TOKEN = open(os.path.expanduser("~/.cache/huggingface/token")).read().strip()


def find_template(name):
    for f in glob.glob(os.path.join(SITE, "comfyui_workflow_templates*", "**", name + ".json"), recursive=True):
        return f
    raise SystemExit(f"template not found: {name}")


def models_of(path):
    d = json.load(open(path, encoding="utf-8"))
    out = list(d.get("models") or [])
    def walk(nodes):
        for n in nodes or []:
            out.extend((n.get("properties") or {}).get("models") or [])
    walk(d.get("nodes"))
    for sg in (d.get("definitions") or {}).get("subgraphs") or []:
        walk(sg.get("nodes"))
    return out


def head_size(url):
    req = urllib.request.Request(url.split("?")[0], method="HEAD", headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return int(r.headers.get("x-linked-size") or r.headers.get("content-length") or 0), None
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def plan():
    files = {}
    for t in TEMPLATES:
        for m in models_of(find_template(t)):
            key = (m["directory"], m["name"])
            files.setdefault(key, {"url": m["url"], "templates": set()})["templates"].add(t)
    with cf.ThreadPoolExecutor(8) as ex:
        sizes = dict(zip(files, ex.map(lambda k: head_size(files[k]["url"]), files)))
    return files, sizes


def main():
    files, sizes = plan()
    total_missing = 0
    rows = []
    for (d, n), info in sorted(files.items()):
        size, err = sizes[(d, n)]
        dest = os.path.join(MODELS, d, n)
        have = os.path.exists(dest) and os.path.getsize(dest) == size
        if not have:
            total_missing += size
        rows.append((d, n, size, have, err, info))
        print(f"{'OK  ' if have else 'NEED'} {size/2**30:6.1f}G {d}/{n} {'ERR '+err if err else ''}")
    print(f"missing total: {total_missing/2**30:.1f} GiB")
    if sys.argv[1:] == ["download"]:
        json.dump([{"dir": d, "name": n, "url": i["url"], "size": s} for d, n, s, h, e, i in rows if not h and not e],
                  open(os.path.join(os.path.dirname(__file__), "to_download.json"), "w"), indent=1)
        print("wrote to_download.json")


if __name__ == "__main__":
    main()
