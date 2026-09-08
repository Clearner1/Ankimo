"""One local Qwen model, sequential JSON requests over the parent's private pipes."""
import contextlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

ROOT = Path.home() / "Library/Application Support/Ankimo"
HOTWORDS = ["Ankimo", "Anki", "Typeless", "微信读书", "skill"]
MAX_TOKENS = 4096


def recording_path(value):
    if not isinstance(value, str):
        raise ValueError("invalid path")
    path = Path(value).resolve(strict=True)
    if path.parent != (ROOT / "capture-audio").resolve():
        raise ValueError("recording outside staging")
    if path.suffix != ".m4a" or not 0 < path.stat().st_size <= 5 * 1024 * 1024:
        raise ValueError("invalid recording")
    return path


def main():
    with contextlib.redirect_stdout(sys.stderr):
        from mlx_audio.stt.utils import load_model
        model = load_model(str(ROOT / "asr/model"))

    for line in sys.stdin:
        try:
            request = json.loads(line)
            source = recording_path(request["path"])
            with tempfile.TemporaryDirectory(prefix="ankimo-asr-") as directory:
                wav = Path(directory) / "audio.wav"
                subprocess.run(
                    ["/opt/homebrew/bin/ffmpeg", "-nostdin", "-v", "error", "-i", str(source),
                     "-vn", "-t", "301", "-ac", "1", "-ar", "16000", str(wav)],
                    check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                with wave.open(str(wav)) as audio:
                    if audio.getnframes() / audio.getframerate() > 300.5:
                        raise ValueError("recording too long")
                with contextlib.redirect_stdout(sys.stderr):
                    result = model.generate(
                        str(wav), language="Chinese", temperature=0, max_tokens=MAX_TOKENS,
                        hotwords=HOTWORDS, verbose=False,
                    )
                if result.generation_tokens >= MAX_TOKENS or not result.text.strip():
                    raise ValueError("incomplete transcript")
                response = {"text": result.text.strip()}
        except Exception:
            response = {"error": "TRANSCRIPTION_FAILED"}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
