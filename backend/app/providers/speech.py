"""Text-to-speech for the AI avatar tutor (read the textbook aloud).

* KokoroSpeech — Kokoro-82M neural voice (Apache-2.0 weights) running offline on the server CPU via ONNX Runtime;
  natural-sounding male / female English voices. Files: python -m scripts.download_voice.
* OfflineSpeech — the operating system's own voices, no network and no keys: Windows SAPI (System.Speech, via
  PowerShell) or espeak-ng on Linux. Picks a male / female voice, preferring an Indian-English one when installed.
* ProviderSpeech — Azure OpenAI / OpenAI text-to-speech (gpt-4o-mini-tts or tts-1) with a male / female voice.

Only textbook text is synthesised; no student data is sent. The text is passed through a temp file (never on a
command line), so it cannot inject shell or PowerShell syntax.
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from functools import lru_cache
from pathlib import Path
from typing import Literal, Protocol

from ..config import get_settings

Voice = Literal["male", "female"]


class SpeechUnavailable(RuntimeError):
    """No speech engine can say this text (missing engine / language)."""


class SpeechProvider(Protocol):
    label: str      # stable id of engine + voices; part of the audio cache key
    engine: str     # shown to users, e.g. "Offline voice (Windows)"

    def synthesize(self, text: str, voice: Voice) -> tuple[bytes, str]:
        """Returns (audio bytes, MIME type)."""
        ...


_PS1 = r"""
param([string]$InFile, [string]$OutFile, [string]$Gender)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $g = [System.Speech.Synthesis.VoiceGender]::$Gender
    $voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Gender -eq $g }
    $pick = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-IN' } | Select-Object -First 1
    if (-not $pick) { $pick = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1 }
    if (-not $pick) { $pick = $voices | Select-Object -First 1 }
    if ($pick) { $s.SelectVoice($pick.VoiceInfo.Name) }
    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s.SetOutputToWaveFile($OutFile, $fmt)
    $s.Speak([IO.File]::ReadAllText($InFile, [Text.Encoding]::UTF8))
} finally { $s.Dispose() }
"""


def _latin_share(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    return sum(c.isascii() for c in letters) / len(letters) if letters else 1.0


def _wav(samples, rate: int) -> bytes:
    """float32 samples in [-1, 1] -> 16-bit mono WAV."""
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _kokoro_files() -> tuple[Path, Path]:
    s = get_settings()
    return Path(s.kokoro_dir, s.kokoro_model), Path(s.kokoro_dir, s.kokoro_voices)


def kokoro_ready() -> bool:
    model, voices = _kokoro_files()
    return model.exists() and voices.exists()


class KokoroSpeech:
    def __init__(self) -> None:
        s = get_settings()
        model, voices = _kokoro_files()
        if not kokoro_ready():
            raise SpeechUnavailable("The neural voice files are missing: run  python -m scripts.download_voice")
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(2, (os.cpu_count() or 4) // 2)
        session = ort.InferenceSession(str(model), sess_options=opts, providers=["CPUExecutionProvider"])
        self.kokoro = Kokoro.from_session(session, str(voices))
        self.voices = {"male": s.kokoro_voice_male, "female": s.kokoro_voice_female}
        self.lang, self.speed = s.kokoro_lang, s.kokoro_speed
        self.engine = "Neural voice (offline)"
        self.label = f"kokoro-{model.stem}-{self.voices['female']}-{self.voices['male']}-{self.lang}-{self.speed}-v1"
        self._lock = threading.Lock()   # one synthesis at a time: each already uses half the CPU cores

    def synthesize(self, text: str, voice: Voice) -> tuple[bytes, str]:
        if _latin_share(text) < 0.6:
            raise SpeechUnavailable("This page is not in English, and the offline neural voice speaks English only.")
        with self._lock:
            samples, rate = self.kokoro.create(text, voice=self.voices[voice], speed=self.speed, lang=self.lang)
        return _wav(samples, rate), "audio/wav"


class OfflineSpeech:
    def __init__(self) -> None:
        if sys.platform == "win32":
            self.kind = "windows"
            self.engine = "Offline voice (Windows)"
        elif shutil.which("espeak-ng"):
            self.kind = "espeak"
            self.engine = "Offline voice (eSpeak NG)"
        else:
            self.kind = ""
            self.engine = "Unavailable"
        self.label = f"offline-{self.kind or 'none'}-v1"

    def synthesize(self, text: str, voice: Voice) -> tuple[bytes, str]:
        if not self.kind:
            raise SpeechUnavailable("Read-aloud needs an offline voice (Windows or espeak-ng) or "
                                    "PROVIDER_MODE=azure / openai.")
        if _latin_share(text) < 0.6:
            # The installed offline voices are English; they would mangle Hindi / Kannada / Tamil script.
            raise SpeechUnavailable("This page is not in English. Reading it aloud needs the Azure / OpenAI voice "
                                    "(set PROVIDER_MODE=azure or TTS_MODE=provider).")
        with tempfile.TemporaryDirectory(prefix="eduai-tts-") as d:
            src, out = Path(d, "in.txt"), Path(d, "out.wav")
            src.write_text(text, encoding="utf-8")
            if self.kind == "windows":
                script = Path(d, "speak.ps1")
                script.write_text(_PS1, encoding="utf-8")
                cmd = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                       "-InFile", str(src), "-OutFile", str(out), "-Gender", "Male" if voice == "male" else "Female"]
            else:
                cmd = ["espeak-ng", "-v", "en+m3" if voice == "male" else "en+f3", "-s", "150", "-f", str(src),
                       "-w", str(out)]
            r = subprocess.run(cmd, capture_output=True, timeout=120,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode != 0 or not out.exists() or out.stat().st_size < 100:
                raise SpeechUnavailable(f"The offline voice failed: {r.stderr.decode(errors='replace')[-300:]}")
            return out.read_bytes(), "audio/wav"


class ProviderSpeech:
    def __init__(self) -> None:
        s = get_settings()
        if s.provider_mode == "openai":
            from openai import OpenAI

            if not s.openai_api_key:
                raise SpeechUnavailable("OPENAI_API_KEY is not configured in .env")
            self.client = OpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url or None, max_retries=2)
            self.model = s.openai_tts_model
            self.engine = f"OpenAI {self.model}"
        else:
            from openai import AzureOpenAI

            if not (s.azure_openai_endpoint and s.azure_openai_api_key):
                raise SpeechUnavailable("AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY are not configured in .env")
            self.client = AzureOpenAI(azure_endpoint=s.azure_openai_endpoint, api_key=s.azure_openai_api_key,
                                      api_version=s.azure_openai_tts_api_version, max_retries=2)
            self.model = s.azure_openai_tts_deployment
            self.engine = f"Azure OpenAI {self.model}"
        self.voices = {"male": s.tts_voice_male, "female": s.tts_voice_female}
        self.label = f"provider-{s.provider_mode}-{self.model}-{self.voices['male']}-{self.voices['female']}-v1"

    def synthesize(self, text: str, voice: Voice) -> tuple[bytes, str]:
        extra = {}
        if "gpt-4o" in self.model:   # steerable model; tts-1 / tts-1-hd do not take instructions
            extra["instructions"] = ("You are a warm, clear school teacher in India reading the class textbook aloud "
                                     "to your students. Steady, unhurried pace; pause briefly between sentences.")
        try:
            resp = self.client.audio.speech.create(model=self.model, voice=self.voices[voice], input=text,
                                                   response_format="mp3", **extra)
        except Exception as e:  # noqa: BLE001 — surface a readable message, never the key
            raise SpeechUnavailable(f"The {self.engine} voice is not available: {type(e).__name__}") from e
        return resp.read(), "audio/mpeg"


@lru_cache
def get_speech() -> SpeechProvider:
    s = get_settings()
    if s.tts_mode == "kokoro" or (s.tts_mode == "auto" and kokoro_ready()):
        return KokoroSpeech()
    if s.tts_mode == "provider" or (s.tts_mode == "auto" and s.provider_mode in ("azure", "openai")):
        return ProviderSpeech()
    return OfflineSpeech()
