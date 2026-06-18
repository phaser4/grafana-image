"""HTTP views for the Grafana Image integration."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import (
    DATA_CACHE,
    DATA_QUEUED_KEYS,
    DATA_RENDER_EVENT,
    DATA_RENDER_QUEUE,
    DATA_RENDER_STATES,
    DOMAIN,
    RENDER_PATH,
    STATUS_PATH,
    STATIC_PATH,
)
from .runtime import (
    QueryValidationError,
    RenderState,
    build_cache_key,
    build_status_message,
    cache_entry_is_fresh,
    cache_entry_is_valid,
    parse_render_request,
    resolve_render_status,
)

FRONTEND_FILE = Path(__file__).parent / "frontend" / "grafana-image-card.js"


class GrafanaImageRenderView(HomeAssistantView):
    """Serve cached Grafana panel PNG images."""

    url = RENDER_PATH
    name = "api:grafana_image:render"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        """Return a cached Grafana rendered panel image when available."""
        hass: HomeAssistant = request.app["hass"]
        runtime = hass.data[DOMAIN]
        cache = runtime[DATA_CACHE]

        try:
            params = parse_render_request(request.query)
        except QueryValidationError as err:
            return _json_error(str(err), 400)

        cache_key = build_cache_key(params)
        cached_entry = cache.get(cache_key)
        if cached_entry and cache_entry_is_valid(cached_entry):
            return web.Response(
                body=cached_entry.content,
                content_type=cached_entry.content_type,
            )

        return _json_error("Grafana image render is queued", 404)


class GrafanaImageStatusView(HomeAssistantView):
    """Report queue and cache status for one Grafana panel render key."""

    url = STATUS_PATH
    name = "api:grafana_image:status"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        """Register render demand and return current status."""
        hass: HomeAssistant = request.app["hass"]
        runtime = hass.data[DOMAIN]

        try:
            params = parse_render_request(request.query)
        except QueryValidationError as err:
            return _json_error(str(err), 400)

        cache_key = build_cache_key(params)
        state = runtime[DATA_RENDER_STATES].setdefault(cache_key, RenderState())
        now = datetime.now(UTC)
        state.last_requested_at = now

        cache_entry = runtime[DATA_CACHE].get(cache_key)
        if cache_entry and not cache_entry_is_valid(cache_entry, now=now):
            cache_entry = None

        if not cache_entry or not cache_entry_is_fresh(cache_entry, now=now):
            _enqueue_render(runtime, cache_key, params, state, now)

        status = resolve_render_status(cache_entry, state, now)
        return web.json_response(
            {
                "status": status,
                "message": build_status_message(status, state),
                "has_cached_image": bool(cache_entry),
                "is_stale": bool(cache_entry) and not cache_entry_is_fresh(cache_entry, now=now),
                "cache_token": cache_entry.rendered_at.isoformat() if cache_entry else None,
                "last_rendered_at": cache_entry.rendered_at.isoformat() if cache_entry else None,
                "last_error": state.last_error,
                "poll_after_ms": _resolve_poll_after_ms(status, params["refresh_seconds"]),
            }
        )


class GrafanaImageStaticView(HomeAssistantView):
    """Serve the frontend card JavaScript."""

    url = STATIC_PATH
    name = "api:grafana_image:static"
    requires_auth = False

    async def get(self, request: web.Request) -> web.FileResponse:
        """Serve the frontend module file."""
        return web.FileResponse(
            FRONTEND_FILE,
            headers={"Cache-Control": "no-cache"},
        )


def async_register_views(hass: HomeAssistant) -> None:
    """Register HTTP views for the integration."""
    hass.http.register_view(GrafanaImageRenderView())
    hass.http.register_view(GrafanaImageStatusView())
    hass.http.register_view(GrafanaImageStaticView())


def _json_error(message: str, status: int) -> web.Response:
    """Create a consistent JSON error response."""
    return web.json_response({"message": message, "domain": DOMAIN}, status=status)


def _enqueue_render(
    runtime: dict,
    cache_key: tuple,
    params: dict[str, object],
    state,
    now: datetime,
) -> None:
    """Queue a render key once if it is not already queued or running."""
    if state.is_queued or state.is_rendering or cache_key in runtime[DATA_QUEUED_KEYS]:
        return

    runtime[DATA_RENDER_QUEUE].append((cache_key, params))
    runtime[DATA_QUEUED_KEYS].add(cache_key)
    runtime[DATA_RENDER_EVENT].set()
    state.is_queued = True
    state.queued_at = now
def _resolve_poll_after_ms(status: str, refresh_seconds: int) -> int:
    """Suggest a frontend poll interval for this status."""
    if status == "ready":
        return max(1000, int(refresh_seconds) * 1000)
    if status == "error":
        return 5000
    return 2000
