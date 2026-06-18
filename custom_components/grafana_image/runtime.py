"""Pure runtime helpers for the Grafana Image integration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Mapping
from urllib.parse import quote, urlencode

CONF_URL = "url"
CONF_API_TOKEN = "api_token"
CONF_CACHE_SECONDS = "cache_seconds"
CONF_TIMEOUT_SECONDS = "timeout_seconds"

DEFAULT_CACHE_SECONDS = 60
DEFAULT_TIMEOUT_SECONDS = 20
DEFAULT_SLUG = "_"
DEFAULT_ORG_ID = 1
DEFAULT_THEME = "dark"
DEFAULT_WIDTH = 900
DEFAULT_HEIGHT = 320

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

    expires_at: datetime
    content: bytes
    content_type: str


def build_runtime_state(config: Mapping[str, Any] | None) -> dict[str, Any]:
    """Build canonical runtime state stored in hass.data."""
    return {
        "config": normalize_integration_config(config),
        "cache": {},
        "fetch_locks": {},
    }


def normalize_integration_config(config: Mapping[str, Any] | None) -> dict[str, Any]:
    """Normalize integration configuration into one canonical dict."""
    raw = dict(config or {})
    return {
        CONF_URL: str(raw.get(CONF_URL, "")).rstrip("/"),
        CONF_API_TOKEN: raw.get(CONF_API_TOKEN) or None,
        CONF_CACHE_SECONDS: int(raw.get(CONF_CACHE_SECONDS, DEFAULT_CACHE_SECONDS)),
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


def build_cache_entry(
    content: bytes, content_type: str, cache_seconds: int, now: datetime | None = None
) -> CacheEntry:
    """Create a cache entry for a successful PNG response."""
    timestamp = now or datetime.now(UTC)
    return CacheEntry(
        expires_at=timestamp + timedelta(seconds=cache_seconds),
        content=content,
        content_type=content_type,
    )


def cache_entry_is_valid(entry: CacheEntry, now: datetime | None = None) -> bool:
    """Return whether a cache entry is still valid."""
    timestamp = now or datetime.now(UTC)
    return entry.expires_at > timestamp


def _parse_positive_int(name: str, value: Any) -> int:
    """Parse a positive integer query parameter."""
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError) as err:
        raise QueryValidationError(f"Invalid numeric query parameter: {name}") from err

    if parsed <= 0:
        raise QueryValidationError(f"Invalid numeric query parameter: {name}")

    return parsed
