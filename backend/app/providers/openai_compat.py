"""OpenAI-compatible providers (chat, embeddings, Whisper) for PROVIDER_MODE=azure (Azure OpenAI
deployments) or PROVIDER_MODE=openai (api.openai.com models). Keys are read from .env via config."""
from __future__ import annotations

import base64
import io
import time
from dataclasses import dataclass
from typing import Iterator

from openai import APIConnectionError, APITimeoutError, AzureOpenAI, OpenAI, RateLimitError

from ..config import get_settings


@dataclass(frozen=True)
class _Models:
    chat: str
    embedding: str
    whisper: str
    label: str


def _client(embedding: bool = False) -> OpenAI:
    s = get_settings()
    if s.provider_mode == "openai":
        if not s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured in .env")
        return OpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url or None, max_retries=0)
    if not (s.azure_openai_endpoint and s.azure_openai_api_key):
        raise RuntimeError("AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY are not configured in .env")
    if embedding and (s.azure_openai_embedding_key or s.azure_openai_embedding_endpoint):
        # FR-EV-08: the embedding model may live in a different Azure resource with its own key.
        return AzureOpenAI(
            azure_endpoint=s.azure_openai_embedding_endpoint or s.azure_openai_endpoint,
            api_key=s.azure_openai_embedding_key or s.azure_openai_api_key,
            api_version=s.azure_openai_embedding_api_version or s.azure_openai_api_version,
            max_retries=0,
        )
    return AzureOpenAI(
        azure_endpoint=s.azure_openai_endpoint,
        api_key=s.azure_openai_api_key,
        api_version=s.azure_openai_api_version,
        max_retries=0,
    )


def _models() -> _Models:
    s = get_settings()
    if s.provider_mode == "openai":
        return _Models(s.openai_chat_model, s.openai_embedding_model, s.openai_whisper_model, f"openai-{s.openai_chat_model}")
    return _Models(s.azure_openai_chat_deployment, s.azure_openai_embedding_deployment,
                   s.azure_openai_whisper_deployment, f"azure-{s.azure_openai_chat_deployment}")


def _with_backoff(fn, attempts: int = 5):
    delay = 1.0
    for i in range(attempts):
        try:
            return fn()
        except (RateLimitError, APIConnectionError, APITimeoutError):
            if i == attempts - 1:
                raise
            time.sleep(delay)
            delay *= 2


class OpenAICompatEmbeddings:
    def __init__(self) -> None:
        self.client = _client(embedding=True)
        self.deployment = _models().embedding
        # text-embedding-3-* can be truncated to the pgvector column size; ada-002 is fixed at 1536.
        self.extra = {"dimensions": get_settings().embedding_dim} if "embedding-3" in self.deployment else {}

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), 64):
            batch = texts[i : i + 64]
            resp = _with_backoff(lambda: self.client.embeddings.create(
                model=self.deployment, input=batch, **self.extra))
            out.extend(d.embedding for d in resp.data)
        return out


class OpenAICompatLLM:
    def __init__(self) -> None:
        self.client = _client()
        self.m = _models()
        self.name = self.m.label[:64]

    def _msgs(self, system: str, messages: list[dict]) -> list[dict]:
        return [{"role": "system", "content": system}, *messages]

    def chat(self, system, messages, *, json_mode=False, temperature=0.2) -> str:
        kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
        resp = _with_backoff(
            lambda: self.client.chat.completions.create(
                model=self.m.chat,
                messages=self._msgs(system, messages),
                temperature=temperature,
                **kwargs,
            )
        )
        return resp.choices[0].message.content or ""

    def chat_stream(self, system, messages, *, temperature=0.2) -> Iterator[str]:
        stream = _with_backoff(
            lambda: self.client.chat.completions.create(
                model=self.m.chat,
                messages=self._msgs(system, messages),
                temperature=temperature,
                stream=True,
            )
        )
        for event in stream:
            if event.choices and event.choices[0].delta and event.choices[0].delta.content:
                yield event.choices[0].delta.content

    def vision_json(self, system: str, text: str, images: list[bytes], *, temperature: float = 0.0) -> str:
        """One multimodal call: JPEG/PNG page images + text, JSON object response (OCR)."""
        content: list[dict] = [{"type": "text", "text": text}]
        for img in images:
            mime = "image/png" if img[:4] == b"\x89PNG" else "image/jpeg"
            content.append({"type": "image_url", "image_url": {
                "url": f"data:{mime};base64,{base64.b64encode(img).decode()}", "detail": "high"}})
        resp = _with_backoff(
            lambda: self.client.chat.completions.create(
                model=self.m.chat,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
        )
        return resp.choices[0].message.content or "{}"

    def transcribe(self, audio: bytes, filename: str) -> str:
        buf = io.BytesIO(audio)
        buf.name = filename
        resp = _with_backoff(
            lambda: self.client.audio.transcriptions.create(model=self.m.whisper, file=buf)
        )
        return resp.text
