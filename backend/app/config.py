"""Application settings, read from backend/.env (see env.example at the repo root)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Core
    environment: str = "development"
    secret_key: str = ""
    database_url: str = "sqlite:///./ceasefire.db"
    cors_origin: str = "http://localhost:3000"

    # Sessions
    session_cookie_name: str = "ceasefire_session"
    session_ttl_days: int = 30
    auth_max_attempts: int = 5
    auth_window_minutes: int = 15

    # SerpApi
    serpapi_key: str = ""
    search_budget_total: int = 250
    search_budget_alert_at: int = 200
    # The burst must exceed the searches ONE sweep spends, or every sweep stalls on
    # the bucket. Worst case is demo_max_permutations (one google search per survivor)
    # + 2 AI Overview + 1 AI Mode + 7 brand engines = 25. The monthly
    # search_budget_total is the quota guard; this bucket only paces the calls.
    serpapi_rate_per_hour: int = 3600
    serpapi_burst: int = 30
    demo_max_permutations: int = 15
    serp_cache_ttl_hours: int = 24

    # Egress / SSRF guards
    egress_timeout_seconds: int = 8
    egress_max_redirects: int = 3
    egress_max_response_bytes: int = 2_000_000

    # Sponsor integrations — all optional, all degrade gracefully
    foxit_client_id: str = ""
    foxit_client_secret: str = ""
    foxit_base_url: str = "https://na1.fusion.foxit.com"
    doctavian_api_key: str = ""
    doctavian_base_url: str = ""
    nutrient_api_key: str = ""
    namecom_username: str = ""
    namecom_token: str = ""
    namecom_base_url: str = "https://api.dev.name.com"

    # Logging
    log_level: str = "INFO"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
