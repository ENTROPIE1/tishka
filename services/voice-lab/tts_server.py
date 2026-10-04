#!/usr/bin/env python3
"""HTTP-служба синтеза речи поверх лаборатории голосов."""
import argparse, io, json, os, re, sys, threading, time, wave
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
MAX_BODY = 20000
CHUNK_LIMIT = 500
PAUSE_MS = 150
RUSSIAN = re.compile(r"[а-яА-ЯёЁ]")
SENTENCE = re.compile(r"(?<=[.!?…\n])")
COMMA = re.compile(r"(?<=[,;])")
def has_russian(text):
    return bool(RUSSIAN.search(text))
def _split_long(segment, limit):
    parts = []
    for token in COMMA.split(segment):
        while len(token) > limit:
            cut = token.rfind(" ", 0, limit)
            cut = limit if cut <= 0 else cut
            parts.append(token[:cut])
            token = token[cut:].lstrip(" ")
        parts.append(token)
    return parts
def split_text(text, limit=CHUNK_LIMIT):
    pieces = []
    for segment in SENTENCE.split(text):
        if segment:
            pieces.extend([segment] if len(segment) <= limit else _split_long(segment, limit))
    chunks, current = [], ""
    for piece in pieces:
        if current and len(current) + len(piece) > limit:
            chunks.append(current)
            current = piece
        else:
            current += piece
    if current:
        chunks.append(current)
    return chunks
def _silence(params, pause_ms):
    count = int(params.framerate * pause_ms / 1000)
    return b"\x00" * (count * params.sampwidth * params.nchannels)
def concat_wav(chunks, pause_ms=PAUSE_MS):
    out = io.BytesIO()
    writer = wave.open(out, "wb")
    first = True
    for data in chunks:
        with wave.open(io.BytesIO(data), "rb") as reader:
            if first:
                writer.setparams(reader.getparams())
            frames = reader.readframes(reader.getnframes())
        if not first:
            writer.writeframes(_silence(writer.getparams(), pause_ms))
        writer.writeframes(frames)
        first = False
    writer.close()
    return out.getvalue()

class TtsApp:
    def __init__(self, synthesizer, voice, speed, pitch):
        self._synth = synthesizer
        self._voice = voice
        self._speed = speed
        self._pitch = pitch
        self._lock = threading.Lock()
        self._state = "loading"
        self._error = ""

    def warm(self):
        with self._lock:
            try:
                self._synth.render("Привет.", self._voice, self._speed, self._pitch)
                self._state = "ok"
            except Exception as exc:
                self._error = str(exc)
                self._state = "error"

    def health(self):
        if self._state == "loading":
            return 503, {"status": "loading"}
        if self._state == "error":
            return 500, {"status": "error", "error": self._error}
        return 200, {"status": "ok", "engine": "Silero", "voice": self._voice, "speed": self._speed, "pitch": self._pitch}

    def _render_retry(self, chunk, voice, speed, pitch):
        # Повтор без расстановки ударений: у поля ruaccent False — режим выключен.
        loaded = hasattr(self._synth, "ruaccent")
        previous = getattr(self._synth, "ruaccent", None)
        if loaded:
            self._synth.ruaccent = False
        try:
            return self._synth.render(chunk, voice, speed, pitch)
        finally:
            if loaded:
                self._synth.ruaccent = previous

    def handle_tts(self, raw):
        started = time.monotonic()
        if len(raw) > MAX_BODY:
            return 400, {"error": "тело запроса больше 20 000 байт"}
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return 400, {"error": "тело не является JSON"}
        if not isinstance(data, dict):
            return 400, {"error": "ожидается объект JSON"}
        text = data.get("text")
        if not isinstance(text, str) or not text.strip():
            return 400, {"error": "пустой текст"}
        voice = data.get("voice", self._voice)
        speed = data.get("speed", self._speed)
        pitch = data.get("pitch", self._pitch)
        chunks = [c for c in split_text(text) if has_russian(c)]
        if not chunks:
            return 422, {"error": "в тексте нет русских букв"}
        with self._lock:
            wavs, retried, skipped = [], 0, 0
            for chunk in chunks:
                try:
                    wavs.append(self._synth.render(chunk, voice, speed, pitch))
                except Exception:
                    retried += 1
                    try:
                        wavs.append(self._render_retry(chunk, voice, speed, pitch))
                    except Exception:
                        skipped += 1
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"{stamp} {len(text)} знаков {int((time.monotonic() - started) * 1000)} мс, повтор: {retried}, пропущено: {skipped}", flush=True)
        if not wavs:
            return 500, {"error": "не удалось синтезировать ни одного куска"}
        return 200, concat_wav(wavs)

class TtsHandler(BaseHTTPRequestHandler):
    app = None
    def log_message(self, *args): return
    def do_GET(self):
        if self.path.split("?")[0] != "/health":
            return self._respond(404, {"error": "не найдено"})
        status, payload = self.app.health()
        self._respond(status, payload)
    def do_POST(self):
        if self.path.split("?")[0] != "/tts":
            return self._respond(404, {"error": "не найдено"})
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length > 0 else b""
        status, payload = self.app.handle_tts(body)
        self._respond(status, payload)
    def _respond(self, status, payload):
        if isinstance(payload, (bytes, bytearray)):
            data, content_type = bytes(payload), "audio/wav"
        else:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            content_type = "application/json; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

def make_server(app, host, port):
    return ThreadingHTTPServer((host, port), type("BoundTtsHandler", (TtsHandler,), {"app": app}))

def load_synthesizer(lab_dir):
    if not os.path.isdir(lab_dir):
        raise FileNotFoundError(f"каталог лаборатории не найден: {lab_dir}")
    if not os.path.isfile(os.path.join(lab_dir, "voice_window.py")):
        raise FileNotFoundError(f"в каталоге нет voice_window.py: {lab_dir}")
    if lab_dir not in sys.path:
        sys.path.insert(0, lab_dir)
    from voice_window import Synthesizer
    return Synthesizer()

def main(argv=None):
    parser = argparse.ArgumentParser(description="Служба синтеза поверх лаборатории голосов")
    parser.add_argument("--lab", required=True, help="каталог лаборатории голосов")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8179)
    parser.add_argument("--voice", default="ru_roman")
    parser.add_argument("--speed", type=float, default=1.10)
    parser.add_argument("--pitch", type=float, default=4.5)
    args = parser.parse_args(argv)
    try:
        synth = load_synthesizer(args.lab)
    except Exception as exc:
        print(f"лаборатория голосов недоступна: {exc}", file=sys.stderr)
        return 2
    app = TtsApp(synth, args.voice, args.speed, args.pitch)
    threading.Thread(target=app.warm, daemon=True).start()
    server = make_server(app, args.host, args.port)
    host, port = server.server_address[:2]
    print(f"Служба синтеза слушает http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
