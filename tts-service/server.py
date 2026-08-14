"""FastAPI sidecar exposing XTTS-v2 zero-shot voice cloning to deadchat's
backend. Runs as a standalone host process (see README.md) - not
containerized, reachable only via the TTS_URL env var deadchat's backend
reads, matching how ComfyUI/Ollama are already integrated.
"""

import os
import tempfile
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from tts_engine import DEFAULT_MODEL, TtsEngine

app = FastAPI(title="deadchat-tts")
engine = TtsEngine(model_name=os.environ.get("TTS_MODEL", DEFAULT_MODEL))


@app.get("/health")
def health():
    return {"ok": True, "model": engine._model_name, "device": engine._device, "model_loaded": engine.model_loaded}


@app.post("/clone")
async def clone(
    background_tasks: BackgroundTasks,
    reference_audio: UploadFile,
    text: str = Form(...),
    language: str = Form("en"),
):
    if not text.strip():
        return JSONResponse(status_code=400, content={"error": "text is required"})

    with tempfile.TemporaryDirectory() as tmp:
        ref_suffix = Path(reference_audio.filename or "ref.wav").suffix or ".wav"
        ref_path = os.path.join(tmp, f"reference{ref_suffix}")
        out_path = os.path.join(tmp, "out.wav")

        with open(ref_path, "wb") as f:
            f.write(await reference_audio.read())

        try:
            engine.clone(text=text, reference_wav_path=ref_path, language=language, out_path=out_path)
        except Exception as e:  # noqa: BLE001 - surface the real error to the caller
            return JSONResponse(status_code=500, content={"error": str(e)})

        with open(out_path, "rb") as f:
            audio_bytes = f.read()

    # tmp dir is fully cleaned up on context exit above (success or failure) -
    # no separate cleanup pass, no fixed shared path, no race under concurrency.
    background_tasks.add_task(engine.unload)
    return Response(content=audio_bytes, media_type="audio/wav")


@app.post("/unload")
def unload():
    engine.unload()
    return {"ok": True}
