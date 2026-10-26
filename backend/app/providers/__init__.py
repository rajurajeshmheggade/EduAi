"""Provider factory. PROVIDER_MODE=mock runs fully offline; azure = Azure OpenAI; openai = OpenAI API."""
from __future__ import annotations

from functools import lru_cache
from typing import Iterator, Protocol

from ..config import get_settings


class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class LLMProvider(Protocol):
    name: str

    def chat(self, system: str, messages: list[dict], *, json_mode: bool = False, temperature: float = 0.2) -> str: ...

    def chat_stream(self, system: str, messages: list[dict], *, temperature: float = 0.2) -> Iterator[str]: ...

    def transcribe(self, audio: bytes, filename: str) -> str: ...

    def vision_json(self, system: str, text: str, images: list[bytes], *, temperature: float = 0.0) -> str:
        """Multimodal JSON call (handwriting OCR). Mock mode raises NotImplementedError."""
        ...


@lru_cache
def get_embedder() -> EmbeddingProvider:
    if get_settings().provider_mode in ("azure", "openai"):
        from .openai_compat import OpenAICompatEmbeddings

        return OpenAICompatEmbeddings()
    from .mock import MockEmbeddings

    return MockEmbeddings()


@lru_cache
def get_llm() -> LLMProvider:
    if get_settings().provider_mode in ("azure", "openai"):
        from .openai_compat import OpenAICompatLLM

        return OpenAICompatLLM()
    from .mock import MockLLM

    return MockLLM()
