# Windows dev entrypoint for the deadchat TTS sidecar.
# First run: creates the venv and installs deps (torch from the CUDA index
# matching your GPU, then the rest of requirements.txt).
# Subsequent runs: just starts the server.

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv")) {
    uv venv --python 3.12 .venv
    uv pip install --python .venv\Scripts\python.exe --index-url https://download.pytorch.org/whl/cu128 torch torchaudio
    uv pip install --python .venv\Scripts\python.exe -r requirements.txt
}

# Accepts the XTTS-v2 CPML license non-interactively (restricts commercial
# use - see README.md). Required or the model download hangs on a stdin
# prompt this headless server can't answer.
$env:COQUI_TOS_AGREED = "1"

$port = if ($env:PORT) { $env:PORT } else { "8020" }
.\.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port $port
