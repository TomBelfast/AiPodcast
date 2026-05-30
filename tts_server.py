#!/usr/bin/env python3
"""
Simple HTTP TTS server wrapping the OpenBrief Supertonic sidecar.
Runs on TTS_PORT (default 8765).

Endpoints:
  POST /synthesize  { "text": "...", "voice": "M1", "model": "supertonic-3" }
                    -> audio/wav binary
  GET  /voices      -> JSON list of available voices
  GET  /health      -> "ok"
"""

import io
import json
import logging
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [TTS] %(message)s")
log = logging.getLogger(__name__)

TTS_PORT = int(os.environ.get("TTS_PORT", "8765"))
SIDECAR_DIR = os.path.join(
    os.path.dirname(__file__),
    "client/apps/tauri/src-tauri/sidecars/supertonic-python",
)
if SIDECAR_DIR not in sys.path:
    sys.path.insert(0, SIDECAR_DIR)

_tts_lock = threading.Lock()
_tts_instance = None


def get_tts(model: str = "supertonic-3"):
    global _tts_instance
    with _tts_lock:
        if _tts_instance is None:
            from supertonic import TTS  # type: ignore
            log.info(f"Loading TTS model: {model}")
            _tts_instance = TTS(model=model, auto_download=True)
            log.info("TTS model loaded")
        return _tts_instance


AVAILABLE_VOICES = ["M1", "M2", "F1", "F2"]


def _do_synthesize(text: str, voice: str, model: str, lang: str = "pl") -> bytes:
    tts = get_tts(model)
    voice_style = tts.get_voice_style(voice_name=voice)
    wav, _duration = tts.synthesize(text=text, voice_style=voice_style, lang=lang)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        tts.save_audio(wav, tmp.name)
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp.name)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info(fmt % args)

    def send_json(self, code: int, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
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

        text = (body.get("text") or "").strip()
        voice = body.get("voice", "F1")
        model = body.get("model", "supertonic-3")
        lang = body.get("lang", "pl")

        if not text:
            self.send_json(400, {"error": "text is required"})
            return

        if voice not in AVAILABLE_VOICES:
            self.send_json(400, {"error": f"voice must be one of {AVAILABLE_VOICES}"})
            return

        try:
            log.info(f"Synthesizing {len(text)} chars, voice={voice}, lang={lang}")
            audio = _do_synthesize(text, voice, model, lang)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(audio)
        except ImportError:
            self.send_json(503, {"error": "supertonic not installed — run: pip install supertonic"})
        except Exception as e:
            log.exception("synthesize failed")
            self.send_json(500, {"error": str(e)})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", TTS_PORT), Handler)
    log.info(f"TTS server listening on :{TTS_PORT}")
    server.serve_forever()
