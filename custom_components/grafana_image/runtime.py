"""Pure runtime helpers for the Grafana Image integration."""

from __future__ import annotations

import base64
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import quote, urlencode

CONF_URL = "url"
CONF_API_TOKEN = "api_token"
CONF_CACHE_SECONDS = "cache_seconds"
CONF_MAX_CONCURRENT_RENDERS = "max_concurrent_renders"
CONF_TIMEOUT_SECONDS = "timeout_seconds"

DEFAULT_CACHE_SECONDS = 60
DEFAULT_MAX_CONCURRENT_RENDERS = 2
DEFAULT_TIMEOUT_SECONDS = 20
DEFAULT_SLUG = "_"
DEFAULT_ORG_ID = 1
DEFAULT_THEME = "dark"
DEFAULT_WIDTH = 900
DEFAULT_HEIGHT = 320
DEFAULT_REFRESH_SECONDS = 600
CACHE_RECORD_VERSION = 2

REQUIRED_QUERY_PARAMS = ("dashboard_uid", "panel_id", "from", "to")
CACHE_KEY_FIELDS = (
    "dashboard_uid",
    "slug",
    "panel_id",
    "org_id",
    "from",
    "to",
    "theme",
    "width",
    "height",
)


class QueryValidationError(ValueError):
    """Raised when render query parameters are invalid."""


@dataclass(slots=True)
class CacheEntry:
    """Cached PNG response metadata."""

    expires_at: datetime | None
    fresh_until: datetime
    rendered_at: datetime
    refresh_seconds: int
    content: bytes
    content_type: str


@dataclass(slots=True)
class RenderState:
    """Queue and render status for one cache key."""

    is_queued: bool = False
    is_rendering: bool = False
    last_requested_at: datetime | None = None
    queued_at: datetime | None = None
    rendering_started_at: datetime | None = None
    last_completed_at: datetime | None = None
    last_error: str | None = None


def build_runtime_state(config: Mapping[str, Any] | None) -> dict[str, Any]:
    """Build canonical runtime state stored in hass.data."""
    return {
        "config": normalize_integration_config(config),
        "cache": {},
        "render_states": {},
        "render_queue": deque(),
        "queued_keys": set(),
        "render_event": None,
    }


def normalize_integration_config(config: Mapping[str, Any] | None) -> dict[str, Any]:
    """Normalize integration configuration into one canonical dict."""
    raw = dict(config or {})
    return {
        CONF_URL: str(raw.get(CONF_URL, "")).rstrip("/"),
        CONF_API_TOKEN: raw.get(CONF_API_TOKEN) or None,
        CONF_CACHE_SECONDS: int(raw.get(CONF_CACHE_SECONDS, DEFAULT_CACHE_SECONDS)),
        CONF_MAX_CONCURRENT_RENDERS: int(
            raw.get(CONF_MAX_CONCURRENT_RENDERS, DEFAULT_MAX_CONCURRENT_RENDERS)
        ),
        CONF_TIMEOUT_SECONDS: int(raw.get(CONF_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS)),
    }


def parse_render_request(query: Mapping[str, str]) -> dict[str, Any]:
    """Validate and normalize a render request from query parameters."""
    missing = [name for name in REQUIRED_QUERY_PARAMS if not str(query.get(name, "")).strip()]
    if missing:
        raise QueryValidationError(
            f"Missing required query parameter(s): {', '.join(sorted(missing))}"
        )

    dashboard_uid = str(query["dashboard_uid"]).strip()
    from_value = str(query["from"]).strip()
    to_value = str(query["to"]).strip()
    slug = str(query.get("slug", DEFAULT_SLUG)).strip() or DEFAULT_SLUG
    theme = str(query.get("theme", DEFAULT_THEME)).strip() or DEFAULT_THEME

    return {
        "dashboard_uid": dashboard_uid,
        "panel_id": _parse_positive_int("panel_id", query["panel_id"]),
        "from": from_value,
        "to": to_value,
        "slug": slug,
        "org_id": _parse_positive_int("org_id", query.get("org_id", DEFAULT_ORG_ID)),
        "theme": theme,
        "width": _parse_positive_int("width", query.get("width", DEFAULT_WIDTH)),
        "height": _parse_positive_int("height", query.get("height", DEFAULT_HEIGHT)),
        "refresh_seconds": _parse_positive_int(
            "refresh_seconds", query.get("refresh_seconds", DEFAULT_REFRESH_SECONDS)
        ),
    }


def build_grafana_render_url(base_url: str, params: Mapping[str, Any]) -> str:
    """Build the Grafana d-solo render URL."""
    path = (
        f"{base_url.rstrip('/')}/render/d-solo/"
        f"{quote(str(params['dashboard_uid']), safe='')}/"
        f"{quote(str(params['slug']), safe='')}"
    )
    query = urlencode(
        {
            "orgId": params["org_id"],
            "panelId": params["panel_id"],
            "from": params["from"],
            "to": params["to"],
            "width": params["width"],
            "height": params["height"],
            "theme": params["theme"],
        }
    )
    return f"{path}?{query}"


def build_cache_key(params: Mapping[str, Any]) -> tuple[Any, ...]:
    """Build a stable cache key from the effective render request."""
    return tuple(params[name] for name in CACHE_KEY_FIELDS)


def build_render_params_from_cache_key(
    cache_key: tuple[Any, ...], refresh_seconds: int
) -> dict[str, Any]:
    """Rebuild render request parameters from a stable cache key."""
    if len(cache_key) != len(CACHE_KEY_FIELDS):
        raise ValueError("Invalid cache key")

    params = dict(zip(CACHE_KEY_FIELDS, cache_key, strict=True))
    params["refresh_seconds"] = _parse_positive_int("refresh_seconds", refresh_seconds)
    return params


def build_cache_entry(
    content: bytes,
    content_type: str,
    cache_seconds: int,
    refresh_seconds: int,
    now: datetime | None = None,
) -> CacheEntry:
    """Create a cache entry for a successful PNG response."""
    timestamp = now or datetime.now(UTC)
    return CacheEntry(
        expires_at=None,
        fresh_until=timestamp + timedelta(seconds=refresh_seconds),
        rendered_at=timestamp,
        refresh_seconds=_parse_positive_int("refresh_seconds", refresh_seconds),
        content=content,
        content_type=content_type,
    )


def cache_entry_is_valid(entry: CacheEntry, now: datetime | None = None) -> bool:
    """Return whether a cache entry is still valid."""
    return bool(entry.content) and bool(entry.content_type)


def cache_entry_is_fresh(entry: CacheEntry, now: datetime | None = None) -> bool:
    """Return whether a cache entry is still fresh enough for direct use."""
    timestamp = now or datetime.now(UTC)
    return entry.fresh_until > timestamp


def resolve_render_status(cache_entry: CacheEntry | None, state: RenderState, now: datetime) -> str:
    """Resolve frontend status for a render key.

    Preserve the last render error until a retry is actively rendering or a
    successful image becomes available, so the UI does not get stuck showing a
    misleading queued state after repeated failures.
    """
    if cache_entry and cache_entry_is_fresh(cache_entry, now=now):
        return "ready"
    if cache_entry:
        return "stale"
    if state.is_rendering:
        return "rendering"
    if state.last_error:
        return "error"
    if state.is_queued:
        return "queued"
    return "queued"


def build_status_message(status: str, state: RenderState) -> str:
    """Build a user-facing status message."""
    if status == "stale":
        return "Refreshing image..."
    if status == "rendering":
        return "Rendering image..."
    if status == "queued":
        return "Image render queued"
    if status == "error":
        return state.last_error or "Grafana image failed to load"
    return ""


def build_cache_file_name(cache_key: tuple[Any, ...]) -> str:
    """Build a stable file name for one cache key."""
    digest = hashlib.sha256(
        json.dumps(list(cache_key), separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    ).hexdigest()
    return f"{digest}.json"


def persist_cache_entry(cache_dir: Path, cache_key: tuple[Any, ...], entry: CacheEntry) -> None:
    """Persist one cache entry to disk."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    payload = serialize_cache_entry(cache_key, entry)
    (cache_dir / build_cache_file_name(cache_key)).write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=True),
        encoding="utf-8",
    )


def load_cache_entries(cache_dir: Path) -> dict[tuple[Any, ...], CacheEntry]:
    """Load persisted cache entries from disk."""
    if not cache_dir.exists():
        return {}

    cache: dict[tuple[Any, ...], CacheEntry] = {}
    for cache_file in cache_dir.glob("*.json"):
        try:
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            cache_key, entry = deserialize_cache_entry(payload)
        except Exception:
            continue

        cache[cache_key] = entry

    return cache


def serialize_cache_entry(cache_key: tuple[Any, ...], entry: CacheEntry) -> dict[str, Any]:
    """Serialize one cache entry to a JSON-safe dict."""
    return {
        "version": CACHE_RECORD_VERSION,
        "cache_key": list(cache_key),
        "expires_at": entry.expires_at.isoformat() if entry.expires_at else None,
        "fresh_until": entry.fresh_until.isoformat(),
        "rendered_at": entry.rendered_at.isoformat(),
        "refresh_seconds": entry.refresh_seconds,
        "content_type": entry.content_type,
        "content_b64": base64.b64encode(entry.content).decode("ascii"),
    }


def deserialize_cache_entry(payload: dict[str, Any]) -> tuple[tuple[Any, ...], CacheEntry]:
    """Deserialize one cache entry from a JSON-safe dict."""
    if payload.get("version") not in {1, CACHE_RECORD_VERSION}:
        raise ValueError("Unsupported cache record version")

    cache_key = tuple(payload["cache_key"])
    expires_at_raw = payload.get("expires_at")
    rendered_at = datetime.fromisoformat(payload["rendered_at"])
    fresh_until = datetime.fromisoformat(payload["fresh_until"])
    refresh_seconds = payload.get("refresh_seconds")
    if refresh_seconds is None:
        refresh_seconds = max(
            1, int((fresh_until - rendered_at).total_seconds())
        )

    return cache_key, CacheEntry(
        expires_at=datetime.fromisoformat(expires_at_raw) if expires_at_raw else None,
        fresh_until=fresh_until,
        rendered_at=rendered_at,
        refresh_seconds=_parse_positive_int("refresh_seconds", refresh_seconds),
        content=base64.b64decode(payload["content_b64"], validate=True),
        content_type=str(payload["content_type"]),
    )


def _parse_positive_int(name: str, value: Any) -> int:
    """Parse a positive integer query parameter."""
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError) as err:
        raise QueryValidationError(f"Invalid numeric query parameter: {name}") from err

    if parsed <= 0:
        raise QueryValidationError(f"Invalid numeric query parameter: {name}")

    return parsed
