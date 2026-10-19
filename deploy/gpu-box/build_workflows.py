"""Build deadchat/backend/src/services/media/workflows.json from ComfyUI API exports.

The exports come from ComfyUI's own template -> API converter (app.graphToPrompt),
so graphs match the official templates exactly. This script only strips demo
content and normalises file names; DeadChat binds prompt/seed/size/etc. at runtime.
"""
import json, os

SRC = os.path.join(os.path.dirname(__file__), "api_workflows.json")
DEST = r"C:\Users\defie\Documents\git\deadchat\backend\src\services\media\workflows.json"

# catalog id -> template export name
PICK = {
    "z-image-turbo": "image_z_image_turbo",
    "qwen-image-2512": "image_qwen_Image_2512",
    "flux2-dev": "image_flux2_text_to_image",
    "wan22-5b": "video_wan2_2_5B_ti2v",
    "wan22-14b-i2v": "video_wan2_2_14B_i2v",
    "ltx25-t2v": "video_ltx2_5_t2v",
    "ltx25-i2v": "video_ltx2_5_i2v",
    "seedance25-t2v": "api_seedance2_5_t2v",
    "seedance25-i2v": "api_seedance2_5_i2v_1080p",
    "wan30-t2v": "api_wan3_0_t2v",
    "wan30-i2v": "api_wan3_0_i2v",
    "kling-o3-t2v": "api_kling_o3_t2v",
    "kling-o3-i2v": "api_kling_o3_i2v",
    "minimax-h3-t2v": "api_minimax_h3_max_t2v",
    "minimax-h3-i2v": "api_minimax_h3_max_i2v",
    "omni-flash-t2v": "api_google_gemini_omni_flash_1_1_t2v",
    "omni-flash-i2v": "api_google_gemini_omni_flash_1_1_i2v",
    "luma-ray33-t2v": "api_luma_ray3_3_t2v",
    "luma-ray33-i2v": "api_luma_ray3_3_i2v",
    "nano-banana-21": "api_nano_banana_2_1_t2i",
    "gpt-image-25": "api_openai_gpt_image_25_sunburst_t2i",
    "seedream-50-pro": "api_bytedance_seedream_5_0_pro_t2i",
    "flux2-max": "api_flux2",
    "ideogram-45": "api_ideogram_v4_5_t2i",
    "recraft-41": "api_recraft_v4_1_t2i",
}

# Prompts we keep: negative prompts from the official templates (they are tuned).
KEEP_TEXT_NODES = {("qwen-image-2512", "238:228"), ("wan22-5b", "7"), ("wan22-14b-i2v", "129:89"),
                   ("ltx25-t2v", "405:373"), ("ltx25-i2v", "398:373")}


def clean(cid, graph):
    g = json.loads(json.dumps(graph))
    for nid, node in list(g.items()):
        ins = node["inputs"]
        ct = node["class_type"]
        if ct in ("CLIPTextEncode", "PrimitiveStringMultiline") and (cid, nid) not in KEEP_TEXT_NODES:
            for k in ("text", "value"):
                if isinstance(ins.get(k), str):
                    ins[k] = ""
        for k in ("prompt", "model.prompt"):
            if isinstance(ins.get(k), str):
                ins[k] = ""
        if ct == "LoadImage":
            ins["image"] = ""
        if ct in ("SaveImage", "SaveImageAdvanced", "SaveVideo") and "filename_prefix" in ins:
            ins["filename_prefix"] = f"deadchat/{cid}"

    if cid == "flux2-dev":
        # Use the fp8 encoder / standard VAE / turbo LoRA we actually ship.
        for node in g.values():
            ins = node["inputs"]
            if node["class_type"] == "CLIPLoader":
                ins["clip_name"] = "mistral_3_small_flux2_fp8.safetensors"
            if node["class_type"] == "VAELoader":
                ins["vae_name"] = "flux2-vae.safetensors"
            if node["class_type"] == "LoraLoaderModelOnly":
                ins["lora_name"] = "Flux2TurboComfyv2.safetensors"

    if cid == "flux2-max":
        # Text-to-image only: drop the demo reference images.
        for nid in [n for n, v in g.items() if v["class_type"] == "LoadImage"]:
            del g[nid]
        for node in g.values():
            for k in [k for k in node["inputs"] if k.startswith("model.images.")]:
                del node["inputs"][k]
            if node["class_type"] == "Flux2ImageNode":
                node["inputs"]["model"] = "Flux.2 [max]"

    if cid.startswith("minimax-h3"):
        # Keep the direct path: prompt -> H3 Max node -> SaveVideo. The optional
        # "context IR" enhancer and 2K regenerate branches duplicate outputs.
        main = next(n for n, v in g.items() if v["class_type"].startswith("MinimaxHailuo03") and "H3 Max" in str(v["inputs"].get("model")))
        g[main]["inputs"]["model.prompt"] = ["14", 0]
        keep = {main, "14"}
        keep |= {n for n, v in g.items() if v["class_type"] == "LoadImage"}
        save = next(n for n, v in g.items() if v["class_type"] == "SaveVideo" and v["inputs"].get("video") == [main, 0])
        keep.add(save)
        for nid in [n for n in g if n not in keep]:
            del g[nid]

    # Drop preview-only nodes (they produce no files and need no inputs).
    for nid in [n for n, v in g.items() if v["class_type"] in ("PreviewAny", "SaveText")]:
        del g[nid]
    for node in g.values():
        for k, v in list(node["inputs"].items()):
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and v[0] not in g:
                del node["inputs"][k]
    return g


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    out = {cid: clean(cid, src[name]["api"]) for cid, name in PICK.items()}
    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {len(out)} workflows -> {DEST}")


if __name__ == "__main__":
    main()
