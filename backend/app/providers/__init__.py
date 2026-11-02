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
def get_tutor_llm() -> LLMProvider:
    """LLM that writes the AI avatar tutor's page explanations (AI_TUTOR_PROVIDER, else PROVIDER_MODE)."""
    mode = get_settings().ai_tutor_provider or get_settings().provider_mode
    if mode in ("azure", "openai"):
        from .openai_compat import OpenAICompatLLM

        return OpenAICompatLLM(mode)
    from .mock import MockLLM

    return MockLLM()


@lru_cache
def get_admission_llm() -> LLMProvider:
    """LLM for admission tests: grading, HQ, report narrative, drafting (ADMISSION_AI_PROVIDER, else PROVIDER_MODE)."""
    mode = get_settings().admission_ai_provider or get_settings().provider_mode
    if mode in ("azure", "openai"):
        from .openai_compat import OpenAICompatLLM

        return OpenAICompatLLM(mode)
    from .mock import MockLLM

    return MockLLM()


@lru_cache
def get_copilot_llm() -> LLMProvider:
    """LLM for the admin Copilot (COPILOT_AI_PROVIDER, else PROVIDER_MODE)."""
    mode = get_settings().copilot_ai_provider or get_settings().provider_mode
    if mode in ("azure", "openai"):
        from .openai_compat import OpenAICompatLLM

        return OpenAICompatLLM(mode)
    from .mock import MockLLM

    return MockLLM()


@lru_cache
def get_llm() -> LLMProvider:
    if get_settings().provider_mode in ("azure", "openai"):
        from .openai_compat import OpenAICompatLLM

        return OpenAICompatLLM()
    from .mock import MockLLM

    return MockLLM()
