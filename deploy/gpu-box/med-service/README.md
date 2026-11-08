# med-service

Specialist medical models for deadchat's case analysis, on the GPU box next to ComfyUI and Ollama.
deadchat calls it at `http://<gpu-box>:8790` (default: the ComfyUI host on port 8790; admins can
change it with `PUT /api/cases/analysis/settings`).

| Model | Status | Input | Licence |
|---|---|---|---|
| PanEcho | ready once torch is installed (weights download from torch.hub on first use) | every frame of an echo loop, 16-frame clips | research use (see the repo's LICENSES.md) |
| EchoAI-Peds | not ready: weights published, loading code not yet | – | CC BY-NC-ND 4.0 |
| CineMA | not ready: needs original cine MRI with spacing | – | MIT |
| TotalSegmentator | not ready: needs original CT in HU | – | Apache-2.0 |

Models that aren't ready show in deadchat's pipeline picker and are skipped; the frame review and
report still run.

## Install (Windows, GPU box)

1. Copy this folder to `C:\Users\defie\med-service`.
2. Run `run-med-service.cmd`. It makes a venv that can see the system site-packages (for torch),
   installs the requirements and starts the server on port 8790.
3. Allow inbound TCP 8790 on the private network in Windows Firewall.
4. Check: `curl http://192.168.0.106:8790/v1/health`.

Models load on first use and unload after `MED_IDLE_UNLOAD_S` seconds idle (default 120), so
ComfyUI and Ollama get the VRAM back. One model runs at a time.
