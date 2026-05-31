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
# completions: monotoniczny licznik ukończonych syntez — pewny sygnał "skończone"
# dla klienta, odporny na race condition (klient czeka aż licznik wzrośnie).
_status = {"state": "idle", "message": "Ready", "device": "unknown",
           "started_at": None, "completions": 0}
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

def _mark_completed():
    with _state_lock:
        _status["completions"] += 1

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

# Jakość syntezy — liczba kroków dyfuzji. Domyślny supertonic to 8 (szybko,
# niższa jakość). Na GPU 32 kroki = ~17x realtime, praktycznie maks. jakość.
# Można nadpisać przez env SUPERTONIC_STEPS lub pole "steps" w requescie.
import os as _os
QUALITY_STEPS = int(_os.environ.get("SUPERTONIC_STEPS", "32"))

# Mapowanie nazw hostów na głosy (można nadpisać w requescie)
DEFAULT_HOST_VOICES = {"ania": "F1", "marek": "M1"}

def _wav_to_array(wav_bytes: bytes):
    """Wczytuje WAV bytes → numpy array (float32, mono)."""
    import io, wave, numpy as np
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        frames = wf.readframes(wf.getnframes())
        sample_rate = wf.getframerate()
        sampwidth = wf.getsampwidth()
        dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(sampwidth, np.int16)
        arr = np.frombuffer(frames, dtype=dtype).astype(np.float32)
        if sampwidth == 2:
            arr /= 32768.0
        elif sampwidth == 4:
            arr /= 2147483648.0
    return arr, sample_rate

def _array_to_wav(arr, sample_rate: int) -> bytes:
    """numpy float32 array → WAV bytes."""
    import io, wave, numpy as np
    pcm = (arr * 32767).clip(-32768, 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()

def _do_synthesize_dialogue(segments: list, voices: dict, model: str = "supertonic-3",
                            steps: int = QUALITY_STEPS) -> bytes:
    """
    Generuje audio dla listy {speaker, text}, skleja w jeden WAV.
    voices: {"ania": "F1", "marek": "M1"}
    """
    import numpy as np
    tts = get_tts(model)
    silence_samples = int(tts.sample_rate * 0.4)  # 400ms ciszy między kwestiami
    silence = np.zeros(silence_samples, dtype=np.float32)

    arrays = []
    total = len(segments)
    for i, seg in enumerate(segments):
        speaker = (seg.get("speaker") or "ania").lower()
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        voice_name = voices.get(speaker) or DEFAULT_HOST_VOICES.get(speaker, "F1")
        _set_status("generating", f"Segment {i+1}/{total} — {speaker} ({voice_name}): {text[:50]}…")
        voice_style = tts.get_voice_style(voice_name=voice_name)
        wav, _ = tts.synthesize(text=text, voice_style=voice_style, lang="na", total_steps=steps)
        # wav shape: (1, samples) — flatten to 1D
        arr = wav[0] if hasattr(wav, '__len__') and len(wav.shape) > 1 else wav
        arrays.append(arr.astype(np.float32))
        arrays.append(silence)

    if not arrays:
        raise ValueError("Brak segmentów do syntezy")

    combined = np.concatenate(arrays)
    _set_status("saving", "Sklejanie i zapis WAV…")
    result = _array_to_wav(combined, tts.sample_rate)
    _set_status("idle", f"Podcast gotowy — {len(combined)/tts.sample_rate:.1f}s, {len(result)//1024} KB")
    _mark_completed()
    return result

def _do_synthesize(text: str, voice: str, model: str, lang: str = "na",
                   steps: int = QUALITY_STEPS) -> bytes:
    _set_status("generating", f"Synteza mowy — {len(text)} znaków, głos {voice}, język {lang}, jakość {steps} kroków…")
    tts = get_tts(model)
    voice_style = tts.get_voice_style(voice_name=voice)

    # chunk count estimate for progress
    chunk_len = 300
    n_chunks = max(1, (len(text) + chunk_len - 1) // chunk_len)
    _set_status("generating", f"Generowanie audio ({n_chunks} fragmentów, {steps} kroków jakości)…")

    wav, duration = tts.synthesize(text=text, voice_style=voice_style, lang=lang, total_steps=steps)

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
    _mark_completed()
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

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def _send_audio(self, audio: bytes):
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(audio)

    def do_POST(self):
        try:
            body = self._read_body()
        except Exception as e:
            self.send_json(400, {"error": f"bad request: {e}"}); return

        if self.path == "/synthesize":
            text  = (body.get("text") or "").strip()
            voice = body.get("voice", "F1")
            model = body.get("model", "supertonic-3")
            lang  = body.get("lang", "na")
            steps = int(body.get("steps") or QUALITY_STEPS)
            if not text:
                self.send_json(400, {"error": "text is required"}); return
            if voice not in AVAILABLE_VOICES:
                self.send_json(400, {"error": f"voice must be one of {AVAILABLE_VOICES}"}); return
            try:
                self._send_audio(_do_synthesize(text, voice, model, lang, steps))
            except Exception as e:
                log.exception("synthesize failed")
                _set_status("idle", f"Błąd: {e}")
                self.send_json(500, {"error": str(e)})

        elif self.path == "/podcast":
            # { segments: [{speaker, text}, ...], voices: {ania: "F1", marek: "M1"} }
            segments = body.get("segments") or []
            voices   = {k.lower(): v for k, v in (body.get("voices") or {}).items()}
            voices   = {**DEFAULT_HOST_VOICES, **voices}
            model    = body.get("model", "supertonic-3")
            steps    = int(body.get("steps") or QUALITY_STEPS)
            if not segments:
                self.send_json(400, {"error": "segments is required"}); return
            try:
                self._send_audio(_do_synthesize_dialogue(segments, voices, model, steps))
            except Exception as e:
                log.exception("podcast failed")
                _set_status("idle", f"Błąd: {e}")
                self.send_json(500, {"error": str(e)})

        else:
            self.send_json(404, {"error": "not found"})


class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True  # pozwala na restart bez czekania na TIME_WAIT

if __name__ == "__main__":
    server = ReusableHTTPServer(("0.0.0.0", TTS_PORT), Handler)
    log.info(f"TTS server on :{TTS_PORT}")
    server.serve_forever()
