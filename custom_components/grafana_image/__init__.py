"""The Grafana Image integration."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import logging
from pathlib import Path

from aiohttp import ClientError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from .const import (
    CONF_API_TOKEN,
    CONF_CACHE_SECONDS,
    CONF_MAX_CONCURRENT_RENDERS,
    CONF_TIMEOUT_SECONDS,
    CONF_URL,
    DEFAULT_CACHE_SECONDS,
    DEFAULT_MAX_CONCURRENT_RENDERS,
    DEFAULT_TIMEOUT_SECONDS,
    DATA_CACHE,
    DATA_CACHE_DIR,
    DATA_QUEUED_KEYS,
    DATA_RENDER_EVENT,
    DATA_RENDER_QUEUE,
    DATA_RENDER_STATES,
    DATA_RENDER_TASK,
    DOMAIN,
)
from .runtime import (
    RenderState,
    build_cache_entry,
    build_grafana_render_url,
    build_runtime_state,
    load_cache_entries,
    persist_cache_entry,
)
from .views import async_register_views

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Required(CONF_URL): cv.url,
                vol.Optional(CONF_API_TOKEN): cv.string,
                vol.Optional(
                    CONF_CACHE_SECONDS, default=DEFAULT_CACHE_SECONDS
                ): cv.positive_int,
                vol.Optional(
                    CONF_MAX_CONCURRENT_RENDERS, default=DEFAULT_MAX_CONCURRENT_RENDERS
                ): cv.positive_int,
                vol.Optional(
                    CONF_TIMEOUT_SECONDS, default=DEFAULT_TIMEOUT_SECONDS
                ): cv.positive_int,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Grafana Image integration from YAML."""
    hass.data[DOMAIN] = build_runtime_state(config.get(DOMAIN))
    runtime_config = hass.data[DOMAIN]["config"]
    cache_dir = Path(hass.config.path(".storage", DOMAIN))
    hass.data[DOMAIN][DATA_CACHE_DIR] = cache_dir
    hass.data[DOMAIN][DATA_CACHE] = await hass.async_add_executor_job(load_cache_entries, cache_dir)
    hass.data[DOMAIN][DATA_RENDER_EVENT] = asyncio.Event()
    async_register_views(hass)

    _LOGGER.info(
        "Grafana Image backend started for %s (token configured: %s, cache_seconds: %s, max_concurrent_renders: %s, timeout_seconds: %s, worker_concurrency: 1)",
        runtime_config[CONF_URL],
        bool(runtime_config.get(CONF_API_TOKEN)),
        runtime_config[CONF_CACHE_SECONDS],
        runtime_config[CONF_MAX_CONCURRENT_RENDERS],
        runtime_config[CONF_TIMEOUT_SECONDS],
    )
    if hass.data[DOMAIN][DATA_CACHE]:
        _LOGGER.info(
            "Grafana Image restored %s cached image(s) from %s",
            len(hass.data[DOMAIN][DATA_CACHE]),
            cache_dir,
        )
    hass.async_create_task(_async_probe_grafana(hass))
    hass.data[DOMAIN][DATA_RENDER_TASK] = hass.async_create_task(_async_render_worker(hass))
    return True


async def _async_probe_grafana(hass: HomeAssistant) -> None:
    """Log whether Grafana is reachable during integration startup."""
    runtime_config = hass.data[DOMAIN]["config"]
    session = async_get_clientsession(hass)
    probe_url = f"{runtime_config[CONF_URL]}/api/health"
    headers = {}
    if runtime_config.get(CONF_API_TOKEN):
        headers["Authorization"] = f"Bearer {runtime_config[CONF_API_TOKEN]}"

    try:
        async with asyncio.timeout(runtime_config[CONF_TIMEOUT_SECONDS]):
            async with session.get(probe_url, headers=headers) as response:
                if response.status == 200:
                    _LOGGER.info(
                        "Grafana Image successfully reached Grafana during startup probe: %s",
                        probe_url,
                    )
                else:
                    body = (await response.text()).strip() or "no response body"
                    _LOGGER.warning(
                        "Grafana Image reached Grafana during startup probe, but got status %s from %s: %s",
                        response.status,
                        probe_url,
                        body,
                    )
    except TimeoutError:
        _LOGGER.warning(
            "Grafana Image startup probe timed out after %s seconds while connecting to %s",
            runtime_config[CONF_TIMEOUT_SECONDS],
            probe_url,
        )
    except ClientError as err:
        _LOGGER.warning(
            "Grafana Image startup probe could not connect to %s: %s",
            probe_url,
            err,
        )
    except Exception as err:  # pragma: no cover - defensive logging
        _LOGGER.exception(
            "Grafana Image startup probe failed unexpectedly for %s: %s",
            probe_url,
            err,
        )


async def _async_render_worker(hass: HomeAssistant) -> None:
    """Process queued render jobs one at a time."""
    runtime = hass.data[DOMAIN]
    queue = runtime[DATA_RENDER_QUEUE]
    render_event = runtime[DATA_RENDER_EVENT]

    while True:
        await render_event.wait()

        while True:
            if not queue:
                render_event.clear()
                if not queue:
                    break
                render_event.set()
                continue

            cache_key, params = queue.popleft()
            runtime[DATA_QUEUED_KEYS].discard(cache_key)
            state = runtime[DATA_RENDER_STATES].setdefault(cache_key, RenderState())
            state.is_queued = False
            state.queued_at = None
            state.is_rendering = True
            state.rendering_started_at = datetime.now(UTC)

            try:
                content, content_type = await _async_fetch_rendered_image(hass, params)
            except TimeoutError:
                state.last_error = "Grafana render request timed out"
                _LOGGER.warning("Grafana Image queued render timed out for %s", cache_key)
            except ClientError as err:
                state.last_error = f"Grafana render request failed: {err}"
                _LOGGER.warning("Grafana Image queued render failed for %s: %s", cache_key, err)
            except Exception as err:  # pragma: no cover - defensive logging
                state.last_error = f"Unexpected internal error: {err}"
                _LOGGER.exception("Grafana Image queued render failed unexpectedly for %s", cache_key)
            else:
                cache_entry = build_cache_entry(
                    content,
                    content_type,
                    runtime["config"][CONF_CACHE_SECONDS],
                    params["refresh_seconds"],
                )
                runtime[DATA_CACHE][cache_key] = cache_entry
                state.last_error = None
                state.last_completed_at = datetime.now(UTC)
                try:
                    await hass.async_add_executor_job(
                        persist_cache_entry,
                        runtime[DATA_CACHE_DIR],
                        cache_key,
                        cache_entry,
                    )
                except Exception as err:  # pragma: no cover - defensive logging
                    _LOGGER.warning(
                        "Grafana Image could not persist cached render for %s: %s",
                        cache_key,
                        err,
                    )
            finally:
                state.is_rendering = False


async def _async_fetch_rendered_image(
    hass: HomeAssistant, params: dict[str, object]
) -> tuple[bytes, str]:
    """Fetch one rendered PNG from Grafana."""
    runtime_config = hass.data[DOMAIN]["config"]
    render_url = build_grafana_render_url(runtime_config[CONF_URL], params)
    headers = {}
    if runtime_config.get(CONF_API_TOKEN):
        headers["Authorization"] = f"Bearer {runtime_config[CONF_API_TOKEN]}"

    session = async_get_clientsession(hass)
    async with asyncio.timeout(runtime_config[CONF_TIMEOUT_SECONDS]):
        async with session.get(render_url, headers=headers) as response:
            content = await response.read()
            content_type = response.headers.get("Content-Type", "").split(";")[0]

            if response.status != 200:
                body = content.decode("utf-8", errors="replace").strip() or "no response body"
                raise ClientError(
                    f"Grafana render failed with status {response.status}: {body}"
                )

            if content_type.lower() != "image/png":
                raise ClientError(
                    "Grafana render returned unexpected content type: "
                    f"{content_type or 'unknown'}"
                )

            return content, content_type
