# ComfyUI on the GPU box (DeadChat media backend)

> This folder mirrors `C:\Users\defie\ComfyUI-Installs` on the GPU box (192.168.0.106): the launcher scripts
> live at its root and the `.py` tools + `api_workflows.json` live in its `tools\` folder.

DeadChat (k8s) sends every image/video job to this ComfyUI at http://192.168.0.106:8188.

## Layout
| What | Where |
|---|---|
| ComfyUI 0.42.1 (git checkout) | `ComfyUI\ComfyUI` |
| Python 3.13 + torch 2.14.1+cu130 | `ComfyUI\standalone-env` |
| Models / input / output / custom_nodes | `C:\Users\defie\ComfyUI-Shared` (passed as `--base-directory`) |
| Service log | `comfyui-service.log` |
| Tools (downloads, workflow export) | `tools\` |

## Start / stop
* Starts hidden at logon: `Startup\DeadChat ComfyUI.vbs` -> `run-comfyui.cmd`, which restarts ComfyUI 10 s after any exit.
* Start now: double-click `start-comfyui-hidden.vbs`.
* Stop: end the `wscript`/`cmd` supervisor first (Task Manager), then `python.exe main.py`; otherwise it restarts.
* Like Ollama, it runs only while `defie` is logged in. To run before logon, register `run-comfyui.cmd` as a
  SYSTEM scheduled task from an elevated prompt:
  `schtasks /Create /TN "DeadChat ComfyUI" /SC ONSTART /RU SYSTEM /TR "C:\Users\defie\ComfyUI-Installs\run-comfyui.cmd"`
  (and delete the Startup .vbs so it isn't started twice).

## Models
`tools\comfy_models.py plan` lists the files the chosen templates need and what is missing;
`tools\download_models.py [substring]` downloads them (resumable, uses the HF token in `~/.cache/huggingface`).
Installed: Z-Image Turbo, Qwen-Image 2512, FLUX.2 [dev] fp8, Wan 2.2 TI2V 5B, Wan 2.2 14B I2V (+ lightx2v),
LTX-2.5 22B int8. Deferred for disk space: Wan 2.2 14B T2V, Qwen-Image-Edit 2511.

## Updating ComfyUI or adding a model
1. `cd ComfyUI\ComfyUI && git fetch --tags && git checkout vX.Y.Z && ..\standalone-env\python.exe -m pip install -r requirements.txt`
   (keep the CUDA torch: never let pip replace it with a `+cpu` build).
2. Re-export workflows: open ComfyUI in a browser and, in the dev console, for each template name run
   `app.loadGraphData(await (await fetch('/templates/<name>.json')).json()); (await app.graphToPrompt()).output`,
   save into `tools\api_workflows.json`, then run `tools\build_workflows.py` (writes DeadChat's `workflows.json`).
3. Add or adjust the entry in `deadchat/backend/src/services/media/catalog.ts`, then run
   `npm test` and `npx ts-node --transpile-only scripts/validate-workflows.ts` in `deadchat/backend`.

## Security note
Windows Firewall is disabled on this machine, so port 8188 (like Ollama's 11434) is open to every network the
box is on and ComfyUI has no authentication. Consider allowing 8188/11434 only from the LAN/cluster.
