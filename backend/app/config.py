"""Central configuration. All secrets come from environment variables (Azure Key Vault
injects them in production). Nothing sensitive is hardcoded here."""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # Repo-root .env first, then backend/.env (later file wins) — put your AI keys in either.
    model_config = SettingsConfigDict(
        env_file=(str(ROOT / ".env"), str(ROOT / "backend" / ".env")), env_file_encoding="utf-8", extra="ignore"
    )

    # --- Runtime ---
    environment: str = "development"
    # mock = offline demo · azure = Azure OpenAI · openai = OpenAI API (api.openai.com)
    provider_mode: Literal["mock", "azure", "openai"] = "mock"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Database ---
    # If DATABASE_URL is empty, an embedded PostgreSQL+pgvector (pgserver) is started for local dev.
    database_url: str = ""
    embedded_pg_dir: str = str(ROOT / ".data" / "pg")

    # --- Auth ---
    jwt_secret: str = "dev-only-change-me-please-use-key-vault-in-prod-0123456789"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 7

    # --- Queue ---
    # Empty -> tasks run in-process on a worker thread. Set to use Celery workers.
    redis_url: str = ""

    # --- Storage ---
    storage_mode: Literal["local", "azure"] = "local"
    storage_root: str = str(ROOT / ".data" / "storage")
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "eduai"
    signed_url_minutes: int = 60
    public_base_url: str = "http://localhost:8000"

    # --- Azure OpenAI ---
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_api_version: str = "2024-06-01"
    # Chat / vision deployment (OCR + grading). Accepts the FRD's names too.
    azure_openai_chat_deployment: str = Field(
        "gpt-4o",
        validation_alias=AliasChoices("AZURE_OPENAI_CHAT_DEPLOYMENT", "AZURE_OPENAI_MODEL_DEPLOYMENT",
                                      "AZURE_OPENAI_DEPLOYMENT_NAME"),
    )
    azure_openai_embedding_deployment: str = "text-embedding-3-small"
    azure_openai_whisper_deployment: str = "whisper"
    # Optional separate embedding resource (FR-EV-08); empty = reuse the chat endpoint / key above.
    azure_openai_embedding_key: str = ""
    azure_openai_embedding_endpoint: str = ""
    azure_openai_embedding_api_version: str = ""

    # --- OpenAI (PROVIDER_MODE=openai) ---
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_chat_model: str = "gpt-4o"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_whisper_model: str = "whisper-1"

    # --- AI evaluation (answer scripts) ---
    eval_ocr_dpi: int = 300            # FRD: pages rendered at 300 DPI for vision OCR
    eval_ocr_pages_per_call: int = 6   # pages sent to the vision model per request
    eval_max_script_pages: int = 40
    eval_max_script_mb: int = 40
    eval_max_upload_files: int = 200

    # --- Attendance ---
    attendance_threshold: float = 75.0  # default % below which a student is flagged (per-org override)

    # --- RAG / chunking (FRD 4.2, 4.3) ---
    rag_top_k: int = 3
    chunk_tokens: int = 600
    chunk_overlap: int = 100
    embedding_dim: int = 1536
    chat_history_turns: int = 5
    max_upload_mb: int = 100

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
