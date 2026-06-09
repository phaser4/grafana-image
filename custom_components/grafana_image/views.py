"""HTTP views for the Grafana Image integration."""

from __future__ import annotations

from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN, RENDER_PATH, STATIC_PATH

FRONTEND_FILE = Path(__file__).parent / "frontend" / "grafana-image-card.js"


class GrafanaImageRenderView(HomeAssistantView):
    """Placeholder render endpoint for Grafana images."""

    url = RENDER_PATH
    name = "api:grafana_image:render"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        """Return a placeholder response until rendering is implemented."""
        return web.json_response(
            {
                "message": (
                    "Grafana render proxy is not implemented yet in this initial scaffold."
                ),
                "domain": DOMAIN,
            },
            status=501,
        )


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
