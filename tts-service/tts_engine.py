"""Thin wrapper around coqui-tts's XTTS-v2 zero-shot voice cloning.

Lazy-loads the model on first use (not at import time, so the server can
start and answer /health before the multi-GB model download/load happens).
Unloads after every request by default (see server.py) - jobs are already
serialized one-at-a-time upstream, so there is no throughput cost to not
keeping the model warm in VRAM, and it keeps this sidecar out of the way of
ComfyUI/Ollama's own VRAM needs on the same GPU.
"""

import gc

import torch
from TTS.api import TTS

DEFAULT_MODEL = "tts_models/multilingual/multi-dataset/xtts_v2"


class TtsEngine:
    def __init__(self, model_name: str = DEFAULT_MODEL, device: str | None = None):
        self._model_name = model_name
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._tts: TTS | None = None

    @property
    def model_loaded(self) -> bool:
        return self._tts is not None

    def _ensure_loaded(self) -> TTS:
        if self._tts is None:
            self._tts = TTS(self._model_name).to(self._device)
        return self._tts

    def clone(self, text: str, reference_wav_path: str, language: str, out_path: str) -> None:
        tts = self._ensure_loaded()
        tts.tts_to_file(
            text=text,
            speaker_wav=reference_wav_path,
            language=language,
            file_path=out_path,
        )

    def unload(self) -> None:
        if self._tts is not None:
            del self._tts
            self._tts = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
