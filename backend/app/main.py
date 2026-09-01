"""Ceasefire API — app factory, CORS, security headers, router mounting."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .db import create_all
from .routers import auth, domains, notices, scans, workspace

logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("ceasefire")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    create_all()
    log.info("database ready: %s", settings.database_url.split("://", 1)[0])
    yield


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title="Ceasefire API",
        version="0.1.0",
        lifespan=lifespan,
        # Docs stay off in production.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    app.add_middleware(SecurityHeadersMiddleware)
    # Exactly one origin — never "*", because credentials ride on every request.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(scans.router)
    app.include_router(notices.router)
    app.include_router(domains.router)
    app.include_router(workspace.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "environment": settings.environment}

    return app


app = create_app()
