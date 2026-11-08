"""Medical specialist models for deadchat case analysis, served on the GPU box.

    GET  /v1/health           -> {gpu, models: [{id, label, ready, error, license, modalities}]}
    POST /v1/analyze/{model}  multipart: meta (JSON), frames (JPEG files in order)
                              -> {model, version, durationS, findings: [...], warnings: [...]}

Run:  python -m uvicorn server:app --host 0.0.0.0 --port 8790
Models load on first use and stay on the GPU until MED_IDLE_UNLOAD_S (default
120 s) of inactivity, so ComfyUI and Ollama get the VRAM back.
"""

from __future__ import annotations

import io
import json
import os
import threading
import time
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

app = FastAPI(title="deadchat med-service")
IDLE_UNLOAD_S = float(os.environ.get("MED_IDLE_UNLOAD_S", "120"))
_lock = threading.Lock()  # one model run at a time: they share one GPU


def _gpu() -> str | None:
    try:
        import torch

        return torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    except Exception:  # noqa: BLE001
        return None


class Adapter:
    id = ""
    label = ""
    license = ""
    modalities: list[str] = []

    def __init__(self) -> None:
        self.model: Any = None
        self.last_used = 0.0
        self.error: str | None = None

    def check(self) -> str | None:
        """None when the model can run, else why not."""
        return None

    def load(self) -> None:
        raise NotImplementedError

    def run(self, frames: list[Any], meta: dict) -> tuple[list[dict], list[str]]:
        raise NotImplementedError

    def unload(self) -> None:
        self.model = None
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass


# ── PanEcho (Yale CarDS): 39 adult echo reporting tasks from 16-frame clips ──

PANECHO_TASKS: dict[str, tuple[str, list[str] | str]] = {
    "pericardial-effusion": ("binary", ["mild/moderate/severe"]),
    "EF": ("reg", "%"),
    "GLS": ("reg", "%"),
    "LVEDV": ("reg", "mL"),
    "LVESV": ("reg", "mL"),
    "LVSV": ("reg", "mL"),
    "LVSize": ("multi", ["Mildly increased", "Moderately/severely increased", "Normal"]),
    "LVWallThickness-increased-any": ("binary", ["Increased"]),
    "LVWallThickness-increased-modsev": ("binary", ["Moderately/severely increased"]),
    "LVSystolicFunction": ("multi", ["Mildly decreased", "Moderately/severely decreased", "Normal/hyperdynamic"]),
    "LVWallMotionAbnormalities": ("binary", ["Present"]),
    "IVSd": ("reg", "cm"),
    "LVPWd": ("reg", "cm"),
    "LVIDs": ("reg", "cm"),
    "LVIDd": ("reg", "cm"),
    "LVOTDiam": ("reg", "cm"),
    "LVDiastolicFunction": ("multi", ["Mild/indeterminate", "Moderate/severe", "Normal"]),
    "E|EAvg": ("reg", "E/e'"),
    "RVSP": ("reg", "mmHg"),
    "RVSize": ("multi", ["Mildly increased", "Moderately/severely increased", "Normal"]),
    "RVSystolicFunction": ("binary", ["Decreased"]),
    "RVIDd": ("reg", "cm"),
    "TAPSE": ("reg", "cm"),
    "RVSVel": ("reg", "cm/s"),
    "LASize": ("multi", ["Mildly dilated", "Moderately/severely dilated", "Normal"]),
    "LAIDs2D": ("reg", "cm"),
    "LAVol": ("reg", "mL"),
    "RASize": ("binary", ["Dilated"]),
    "RADimensionM-L(cm)": ("reg", "cm"),
    "AVStructure": ("binary", ["Bicuspid"]),
    "AVStenosis": ("multi", ["Mild/moderate", "None", "Severe"]),
    "AVPkVel(m|s)": ("reg", "m/s"),
    "AVRegurg": ("multi", ["Mild", "Moderate/severe", "None/trace"]),
    "LVOT20mmHg": ("binary", ["Present"]),
    "MVStenosis": ("binary", ["Mild/moderate/severe"]),
    "MVRegurgitation": ("multi", ["Mild", "Moderate/severe", "None/trace"]),
    "TVRegurgitation": ("multi", ["Mild", "Moderate/severe", "None/trace"]),
    "TVPkGrad": ("reg", "mmHg"),
    "RAP-8-or-higher": ("binary", ["Present"]),
    "AORoot": ("reg", "cm"),
}


class PanEcho(Adapter):
    id = "panecho"
    label = "PanEcho"
    license = "See CarDS-Yale/PanEcho LICENSES.md (research use)"
    modalities = ["US"]
    CLIP = 16

    def load(self) -> None:
        import torch

        m = torch.hub.load("CarDS-Yale/PanEcho", "PanEcho", force_reload=False, clip_len=self.CLIP)
        self.model = m.eval().to("cuda" if torch.cuda.is_available() else "cpu")

    def _clips(self, frames: list[Any]):
        """Every frame, as consecutive 16-frame clips (last clip padded by repeating), ImageNet-normalised."""
        import numpy as np
        import torch

        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = [((np.asarray(f.convert("RGB").resize((224, 224))).astype(np.float32) / 255.0) - mean) / std for f in frames]
        clips = []
        for s in range(0, len(arr), self.CLIP):
            chunk = arr[s : s + self.CLIP]
            if len(chunk) < self.CLIP:
                if s > 0:  # take the tail from the previous frames instead of padding when we can
                    chunk = arr[max(0, len(arr) - self.CLIP) :]
                chunk = chunk + [chunk[-1]] * (self.CLIP - len(chunk))
            clips.append(torch.from_numpy(np.stack(chunk)).permute(3, 0, 1, 2))  # C,T,H,W
        return torch.stack(clips)

    def run(self, frames, meta):
        import torch

        warnings = ["PanEcho was trained on adult echocardiograms; measurements in children are unvalidated."] if _is_child(meta) else []
        x = self._clips(frames).to(next(self.model.parameters()).device)
        with torch.no_grad():
            outs = [self.model(x[i : i + 4]) for i in range(0, len(x), 4)]
        findings = []
        for task, (kind, spec) in PANECHO_TASKS.items():
            vals = [o[task] for o in outs if task in o]
            if not vals:
                continue
            v = torch.cat(vals).float().mean(0).flatten().cpu()  # average over clips = study-level
            if kind == "reg":
                findings.append({"label": task, "value": round(float(v[0]), 2), "unit": spec})
            elif kind == "binary":
                findings.append({"label": f"{task}: {spec[0]}", "probability": round(float(v[-1]), 3)})
            else:
                i = int(v.argmax())
                label = spec[i] if i < len(spec) else str(i)
                findings.append({"label": task, "value": label, "probability": round(float(v[i]), 3)})
        warnings.append(f"Averaged over {len(x)} clip(s) of {self.CLIP} frames covering all {len(frames)} frames; one view only, not a full study.")
        return findings, warnings


# ── Models whose weights or inputs need more than JPEG frames ──


class Pending(Adapter):
    reason = ""

    def check(self) -> str | None:
        return self.reason


class EchoAIPeds(Pending):
    id = "echoai-peds"
    label = "EchoAI-Peds"
    license = "CC BY-NC-ND 4.0 (non-commercial)"
    modalities = ["US"]
    reason = "weights are on Hugging Face (hiesingerlab/echoai-peds) but loading code isn’t published yet"


class CineMA(Pending):
    id = "cinema"
    label = "CineMA"
    license = "MIT"
    modalities = ["MR"]
    reason = "needs the original cine MRI with pixel spacing (DICOM), not JPEG frames; adapter not built yet"


class TotalSegmentator(Pending):
    id = "totalsegmentator"
    label = "TotalSegmentator"
    license = "Apache-2.0 (some tasks need a licence)"
    modalities = ["CT", "MR"]
    reason = "needs the original CT in Hounsfield units (DICOM), not windowed JPEG slices; adapter not built yet"


def _is_child(meta: dict) -> bool:
    a = str(meta.get("age") or "").strip().upper()
    if len(a) == 4 and a[:3].isdigit():
        return a[3] != "Y" or int(a[:3]) < 18
    import re

    m = re.search(r"(\d+(?:\.\d+)?)\s*(y|m|w|d)", a.lower())
    return bool(m) and (m.group(2) != "y" or float(m.group(1)) < 18)


ADAPTERS: dict[str, Adapter] = {a.id: a for a in (PanEcho(), EchoAIPeds(), CineMA(), TotalSegmentator())}


@app.get("/v1/health")
def health():
    return {
        "gpu": _gpu(),
        "models": [
            {
                "id": a.id,
                "label": a.label,
                "ready": a.check() is None and a.error is None,
                "error": a.check() or a.error,
                "license": a.license,
                "modalities": a.modalities,
                "loaded": a.model is not None,
            }
            for a in ADAPTERS.values()
        ],
    }


@app.post("/v1/analyze/{model_id}")
async def analyze(model_id: str, meta: str = Form("{}"), frames: list[UploadFile] = File(...)):
    from PIL import Image

    a = ADAPTERS.get(model_id)
    if not a:
        raise HTTPException(404, f"unknown model {model_id}")
    why = a.check()
    if why:
        raise HTTPException(409, why)
    if not frames:
        raise HTTPException(400, "no frames")
    imgs = [Image.open(io.BytesIO(await f.read())) for f in frames]
    m = json.loads(meta or "{}")
    t0 = time.time()
    with _lock:
        try:
            if a.model is None:
                a.load()
            a.error = None
            findings, warnings = a.run(imgs, m)
        except Exception as e:  # noqa: BLE001
            a.error = f"{type(e).__name__}: {e}"
            raise HTTPException(500, a.error) from e
        finally:
            a.last_used = time.time()
    return {"model": a.id, "version": None, "durationS": round(time.time() - t0, 2), "findings": findings, "warnings": warnings}


def _reaper() -> None:
    while True:
        time.sleep(15)
        for a in ADAPTERS.values():
            if a.model is not None and time.time() - a.last_used > IDLE_UNLOAD_S and _lock.acquire(blocking=False):
                try:
                    a.unload()
                finally:
                    _lock.release()


threading.Thread(target=_reaper, daemon=True).start()
