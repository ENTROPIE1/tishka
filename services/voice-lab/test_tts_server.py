import io
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts_server import TtsApp, has_russian, main, make_server, split_text
RATE = 16000
CHUNK_MS = 100
def make_wav(ms=CHUNK_MS):
    frames = int(RATE * ms / 1000)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(RATE)
        writer.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()

class FakeSynth:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def render(self, text, voice, speed=1.0, pitch=0.0):
        if self.fail:
            raise RuntimeError("синтез сломан")
        self.calls.append((text, voice, speed, pitch))
        return make_wav()

class AccentSynth:
    def __init__(self, fail_times=0):
        self.ruaccent = "loaded"
        self.fail_times = fail_times
        self.seen = []

    def render(self, text, voice, speed=1.0, pitch=0.0):
        self.seen.append((text, self.ruaccent))
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("омограф сломан")
        return make_wav()

class FlakySynth:
    def __init__(self):
        self.fail_times = 1

    def render(self, text, voice, speed=1.0, pitch=0.0):
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("сбой")
        return make_wav()

class SelectiveSynth:
    def __init__(self):
        self.ruaccent = "loaded"

    def render(self, text, voice, speed=1.0, pitch=0.0):
        if "Плохой" in text:
            raise RuntimeError("нет ударения")
        return make_wav()

class ServerCase(unittest.TestCase):
    def setUp(self):
        self.synth = FakeSynth()
        self.app = TtsApp(self.synth, "ru_roman", 1.10, 4.5)
        self.server = make_server(self.app, "127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, payload=None):
        data = None
        if payload is not None:
            data = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}", data=data, method=method
        )
        try:
            with opener.open(req) as resp:
                return resp.status, resp.read(), resp.headers.get_content_type()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), exc.headers.get_content_type()
    def test_health_loading_then_ok(self):
        status, body, _ = self.request("GET", "/health")
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(body)["status"], "loading")
        self.app.warm()
        status, body, _ = self.request("GET", "/health")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["engine"], "Silero")
        self.assertEqual(data["voice"], "ru_roman")
        self.assertAlmostEqual(data["speed"], 1.10)
        self.assertAlmostEqual(data["pitch"], 4.5)

    def test_health_error_after_broken_warm(self):
        self.synth.fail = True
        self.app.warm()
        status, body, _ = self.request("GET", "/health")
        self.assertEqual(status, 500)
        self.assertEqual(json.loads(body)["status"], "error")

    def test_normal_request(self):
        self.app.warm()
        status, body, ctype = self.request("POST", "/tts", {"text": "Привет, мир"})
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "audio/wav")
        self.assertEqual(body[:4], b"RIFF")

    def test_empty_text(self):
        status, body, _ = self.request("POST", "/tts", {"text": "   "})
        self.assertEqual(status, 400)
        self.assertIn("error", json.loads(body))

    def test_not_json(self):
        status, _, _ = self.request("POST", "/tts", b"not json")
        self.assertEqual(status, 400)

    def test_body_too_large(self):
        status, _, _ = self.request("POST", "/tts", b"{" + b"x" * 20001)
        self.assertEqual(status, 400)

    def test_no_russian(self):
        status, _, _ = self.request("POST", "/tts", {"text": "hello world"})
        self.assertEqual(status, 422)

    def test_override_params(self):
        self.request(
            "POST",
            "/tts",
            {"text": "Привет", "voice": "ru_ekaterina", "speed": 1.05, "pitch": 2.5},
        )
        self.assertEqual(self.synth.calls[-1], ("Привет", "ru_ekaterina", 1.05, 2.5))
    def test_long_text(self):
        text = "".join(
            f"Это предложение номер {i}, и оно достаточно длинное. " for i in range(20)
        )
        chunks = [c for c in split_text(text) if has_russian(c)]
        self.assertGreater(len(chunks), 1)
        status, body, ctype = self.request("POST", "/tts", {"text": text})
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "audio/wav")
        with wave.open(io.BytesIO(body), "rb") as reader:
            frames = reader.getnframes()
            rate = reader.getframerate()
        expected = len(chunks) * int(rate * CHUNK_MS / 1000)
        expected += (len(chunks) - 1) * int(rate * 0.150)
        self.assertEqual(frames, expected)
    def test_synth_error_keeps_service(self):
        self.synth.fail = True
        status, _, _ = self.request("POST", "/tts", {"text": "Привет"})
        self.assertEqual(status, 500)
        self.synth.fail = False
        status, _, _ = self.request("POST", "/tts", {"text": "Привет"})
        self.assertEqual(status, 200)

    def test_retry_disables_stress_then_restores(self):
        synth = AccentSynth(fail_times=1)
        self.app._synth = synth
        status, body, _ = self.request("POST", "/tts", {"text": "Привет"})
        self.assertEqual(status, 200)
        self.assertEqual(synth.seen, [("Привет", "loaded"), ("Привет", False)])
        self.assertEqual(synth.ruaccent, "loaded")

    def test_retry_without_field_repeats_call(self):
        self.app._synth = FlakySynth()
        status, _, _ = self.request("POST", "/tts", {"text": "Привет"})
        self.assertEqual(status, 200)

    def test_skipped_chunk_keeps_others(self):
        self.app._synth = SelectiveSynth()
        text = "Плохой " + "а" * 300 + "." + "Хороший " + "б" * 300 + "."
        status, body, ctype = self.request("POST", "/tts", {"text": text})
        self.assertEqual((status, ctype), (200, "audio/wav"))
        with wave.open(io.BytesIO(body), "rb") as reader:
            self.assertEqual(reader.getnframes(), int(RATE * CHUNK_MS / 1000))

    def test_all_chunks_fail_gives_500(self):
        synth = AccentSynth(fail_times=100)
        self.app._synth = synth
        status, _, _ = self.request("POST", "/tts", {"text": "Привет"})
        self.assertEqual(status, 500)
        self.assertEqual(synth.ruaccent, "loaded")

    def test_main_missing_lab(self):
        self.assertEqual(main(["--lab", "нет-такого-каталога"]), 2)

if __name__ == "__main__":
    unittest.main()
