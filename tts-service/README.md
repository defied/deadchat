# deadchat TTS sidecar

Small FastAPI service wrapping XTTS-v2 (via the actively-maintained `coqui-tts`
PyPI package) for zero-shot voice cloning. Used by deadchat's `character_voice`
asset type and the `POST /api/characters/:id/speak` endpoint.

Runs as a standalone process on the same host as ComfyUI/Ollama (this machine's
GPU) - not containerized, not part of `docker-compose.yml`/Helm, same pattern
as those two. The backend reaches it via the `TTS_URL` env var.

## License

XTTS-v2's weights are under Coqui's CPML license, which **restricts commercial
use**. Fine for personal/hobby use; worth knowing before running this in a
commercial deployment.

## Setup

```powershell
cd tts-service
.\run.ps1
```

First run creates a venv, installs a CUDA-matched torch build plus the rest of
`requirements.txt`, and starts the server on port 8020 (override with `$env:PORT`).
The XTTS-v2 model (~2GB) downloads on first `/clone` call, not at startup.

## API

- `GET /health` -> `{ok, model, device, model_loaded}`
- `POST /clone` (multipart: `reference_audio` file, `text`, `language` form fields) -> raw `audio/wav` bytes
- `POST /unload` -> releases the model from VRAM

Manual smoke test:

```bash
curl -F reference_audio=@clip.wav -F text="hello world" -F language=en \
  http://localhost:8020/clone -o out.wav
```

## Notes

- Model unloads from VRAM after every `/clone` call (background task) - jobs
  are already serialized one-at-a-time by deadchat's job queue, so there's no
  throughput cost, and it avoids needing to coordinate VRAM eviction against
  ComfyUI/Ollama for a warm-kept model.
- `coqui-tts` declares `transformers>=4.57` with no upper bound, but its XTTS
  code breaks on transformers 5.x - `requirements.txt` pins `<5`. If a fresh
  install breaks on `isin_mps_friendly` import errors, this is why.
- Reference clips: 10-30s of clean single-speaker audio works best.
