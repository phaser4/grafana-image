"""HTTP views for the Grafana Image integration."""

from __future__ import annotations

import asyncio
from pathlib import Path

from aiohttp import ClientError
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_API_TOKEN,
    CONF_CACHE_SECONDS,
    CONF_TIMEOUT_SECONDS,
    CONF_URL,
    DATA_CACHE,
    DATA_CONFIG,
    DOMAIN,
    RENDER_PATH,
    STATIC_PATH,
)
from .runtime import (
    QueryValidationError,
    build_cache_entry,
    build_cache_key,
    build_grafana_render_url,
    cache_entry_is_valid,
    parse_render_request,
)

FRONTEND_FILE = Path(__file__).parent / "frontend" / "grafana-image-card.js"


class GrafanaImageRenderView(HomeAssistantView):
    """Render Grafana panels as PNG images."""

    url = RENDER_PATH
    name = "api:grafana_image:render"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        """Fetch a Grafana rendered panel image through Home Assistant."""
        hass: HomeAssistant = request.app["hass"]
        runtime = hass.data[DOMAIN]
        config = runtime[DATA_CONFIG]
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

        render_url = build_grafana_render_url(config[CONF_URL], params)
        headers = {}
        if config.get(CONF_API_TOKEN):
            headers["Authorization"] = f"Bearer {config[CONF_API_TOKEN]}"

        session = async_get_clientsession(hass)

        try:
            async with asyncio.timeout(config[CONF_TIMEOUT_SECONDS]):
                async with session.get(render_url, headers=headers) as response:
                    content = await response.read()
                    content_type = response.headers.get("Content-Type", "").split(";")[0]

                    if response.status != 200:
                        detail = _decode_error_body(content)
                        return _json_error(
                            f"Grafana render failed with status {response.status}: {detail}",
                            502,
                        )

                    if content_type.lower() != "image/png":
                        return _json_error(
                            (
                                "Grafana render returned unexpected content type: "
                                f"{content_type or 'unknown'}"
                            ),
                            502,
                        )
        except TimeoutError:
            return _json_error("Grafana render request timed out", 504)
        except ClientError as err:
            return _json_error(f"Grafana render request failed: {err}", 502)
        except Exception as err:  # pragma: no cover - defensive guard
            return _json_error(f"Unexpected internal error: {err}", 500)

        cache_seconds = config[CONF_CACHE_SECONDS]
        if cache_seconds > 0:
            cache[cache_key] = build_cache_entry(content, content_type, cache_seconds)

        return web.Response(body=content, content_type=content_type)


class GrafanaImageStaticView(HomeAssistantView):
    """Serve the frontend card JavaScript."""

    url = STATIC_PATH
    name = "api:grafana_image:static"
    requires_auth = True

    async def get(self, request: web.Request) -> web.FileResponse:
        """Serve the frontend module file."""
        return web.FileResponse(
            FRONTEND_FILE,
            headers={"Cache-Control": "no-cache"},
        )


def async_register_views(hass: HomeAssistant) -> None:
    """Register HTTP views for the integration."""
    hass.http.register_view(GrafanaImageRenderView())
    hass.http.register_view(GrafanaImageStaticView())


def _json_error(message: str, status: int) -> web.Response:
    """Create a consistent JSON error response."""
    return web.json_response({"message": message, "domain": DOMAIN}, status=status)


def _decode_error_body(content: bytes) -> str:
    """Decode upstream error content for diagnostics."""
    decoded = content.decode("utf-8", errors="replace").strip()
    return decoded or "no response body"
