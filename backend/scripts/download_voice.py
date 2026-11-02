"""Downloads the offline neural voice for the AI avatar tutor (Kokoro v1.0, Apache-2.0 weights).

    python -m scripts.download_voice            # model (~325 MB) + voices (~28 MB) into .data/models/kokoro
    python -m scripts.download_voice --small    # int8 model (~92 MB) instead; ~3x slower on most CPUs

Files come from the kokoro-onnx GitHub release "model-files-v1.0". With --small set KOKORO_MODEL=kokoro-v1.0.int8.onnx.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx

from app.config import get_settings

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MIN_BYTES = {"kokoro-v1.0.int8.onnx": 80_000_000, "kokoro-v1.0.onnx": 300_000_000, "voices-v1.0.bin": 25_000_000}


def fetch(name: str, dest: Path) -> None:
    target = dest / name
    if target.exists() and target.stat().st_size >= MIN_BYTES[name]:
        print(f"{name}: already present ({target.stat().st_size // 1_000_000} MB)")
        return
    tmp = target.with_suffix(target.suffix + ".part")
    with httpx.stream("GET", RELEASE + name, follow_redirects=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with tmp.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r{name}: {done * 100 // total:3d}% of {total // 1_000_000} MB", end="", flush=True)
    print()
    if tmp.stat().st_size < MIN_BYTES[name]:
        tmp.unlink()
        sys.exit(f"{name}: download incomplete")
    tmp.replace(target)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--small", action="store_true", help="int8 model (smaller download, slower on CPU)")
    args = ap.parse_args()
    dest = Path(get_settings().kokoro_dir)
    dest.mkdir(parents=True, exist_ok=True)
    fetch("kokoro-v1.0.int8.onnx" if args.small else "kokoro-v1.0.onnx", dest)
    fetch("voices-v1.0.bin", dest)
    print(f"Voice files ready in {dest}")


if __name__ == "__main__":
    main()
