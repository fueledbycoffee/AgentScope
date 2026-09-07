"""Runtime configuration from environment variables (see .env.example)."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENTSCOPE_", env_file=".env", extra="ignore")

    llm_provider: str = "openai_compatible"
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = ""
    llm_api_key: SecretStr = Field(default=SecretStr(""))

    database_url: str = "sqlite:///./data/agentscope.sqlite3"
    raw_file_dir: Path = Path("./data/raw-files")
    bundled_mappings_dir: Path = Path(__file__).resolve().parents[3] / "mappings"

    host: str = "127.0.0.1"
    port: int = 8000
