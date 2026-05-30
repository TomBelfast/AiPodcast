#!/usr/bin/env python3
"""
TTS HTTP server wrapping Supertonic.
Runs on TTS_PORT (default 8765).

Endpoints:
  POST /synthesize   { "text", "voice", "model", "lang" } -> audio/wav
  GET  /status       -> { "state", "message", "device" }
  GET  /voices       -> { "voices": [...] }
  GET  /health       -> { "status": "ok" }
"""

import collections
import json
import logging
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [TTS] %(message)s")
log = logging.getLogger(__name__)

TTS_PORT = int(os.environ.get("TTS_PORT", "8765"))

# ── GPU setup ──────────────────────────────────────────────────────────────────
# Monkey-patch supertonic's default providers before it is imported so that
# the ONNX InferenceSessions are created with CUDAExecutionProvider when
# onnxruntime-gpu is installed and a GPU is accessible.
try:
    import onnxruntime as ort
    _available = ort.get_available_providers()
    if "CUDAExecutionProvider" in _available:
        import supertonic.loader as _loader
        _loader.DEFAULT_ONNX_PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        log.info("GPU mode: CUDAExecutionProvider enabled")
    else:
        log.warning("GPU not available — falling back to CPU. Providers: %s", _available)
except Exception as _e:
    log.warning("Could not configure GPU providers: %s", _e)

# ── State ──────────────────────────────────────────────────────────────────────
_state_lock = threading.Lock()
_status = {"state": "idle", "message": "Ready", "device": "unknown", "started_at": None}
_log_lines: collections.deque = collections.deque(maxlen=50)

def _set_status(state: str, message: str):
    with _state_lock:
        _status["state"] = state
        _status["message"] = message
        if state == "generating":
            _status["started_at"] = time.time()
        elif state == "idle":
            _status["started_at"] = None
    _log_lines.append(f"[{time.strftime('%H:%M:%S')}] {message}")
    log.info(message)

# ── TTS instance ───────────────────────────────────────────────────────────────
_tts_lock = threading.Lock()
_tts_instance = None

def get_tts(model: str = "supertonic-3"):
    global _tts_instance
    with _tts_lock:
        if _tts_instance is None:
            _set_status("loading", f"Ładowanie modelu {model}…")
            from supertonic import TTS  # type: ignore
            _tts_instance = TTS(model=model, auto_download=True)
            # detect which device was actually used
            try:
                import supertonic.loader as ldr
                device = "GPU" if "CUDA" in str(ldr.DEFAULT_ONNX_PROVIDERS) else "CPU"
            except Exception:
                device = "unknown"
            with _state_lock:
                _status["device"] = device
            _set_status("idle", f"Model załadowany ({device})")
        return _tts_instance

AVAILABLE_VOICES = ["M1", "M2", "F1", "F2"]

def _do_synthesize(text: str, voice: str, model: str, lang: str = "pl") -> bytes:
    _set_status("generating", f"Synteza mowy — {len(text)} znaków, głos {voice}, język {lang}…")
    tts = get_tts(model)
    voice_style = tts.get_voice_style(voice_name=voice)

    # chunk count estimate for progress
    chunk_len = 300
    n_chunks = max(1, (len(text) + chunk_len - 1) // chunk_len)
    _set_status("generating", f"Generowanie audio ({n_chunks} fragmentów)…")

    wav, duration = tts.synthesize(text=text, voice_style=voice_style, lang=lang)

    _set_status("saving", "Zapisywanie pliku WAV…")
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        tts.save_audio(wav, tmp.name)
        with open(tmp.name, "rb") as f:
            data = f.read()
    finally:
        os.unlink(tmp.name)

    dur = float(duration[0]) if hasattr(duration, '__len__') else float(duration)
    _set_status("idle", f"Gotowe — {dur:.1f}s audio, {len(data)//1024} KB")
    return data

# ── HTTP handler ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # wycisz httpserver — mamy własne logi

    def send_json(self, code: int, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
        elif self.path == "/status":
            with _state_lock:
                s = dict(_status)
            elapsed = None
            if s["started_at"]:
                elapsed = round(time.time() - s["started_at"], 1)
            self.send_json(200, {**s, "elapsed_s": elapsed, "logs": list(_log_lines)[-10:]})
        elif self.path == "/voices":
            self.send_json(200, {"voices": AVAILABLE_VOICES})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
        except Exception as e:
            self.send_json(400, {"error": f"bad request: {e}"})
            return

        text  = (body.get("text") or "").strip()
        voice = body.get("voice", "F1")
        model = body.get("model", "supertonic-3")
        lang  = body.get("lang", "pl")

        if not text:
            self.send_json(400, {"error": "text is required"}); return
        if voice not in AVAILABLE_VOICES:
            self.send_json(400, {"error": f"voice must be one of {AVAILABLE_VOICES}"}); return

        try:
            audio = _do_synthesize(text, voice, model, lang)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(audio)
        except ImportError:
            self.send_json(503, {"error": "supertonic not installed"})
        except Exception as e:
            log.exception("synthesize failed")
            _set_status("idle", f"Błąd: {e}")
            self.send_json(500, {"error": str(e)})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", TTS_PORT), Handler)
    log.info(f"TTS server on :{TTS_PORT}")
    server.serve_forever()
