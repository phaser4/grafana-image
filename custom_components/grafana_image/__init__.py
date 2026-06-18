"""The Grafana Image integration."""

from __future__ import annotations

import asyncio
import logging

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
    DATA_RENDER_SEMAPHORE,
    DOMAIN,
)
from .runtime import build_runtime_state
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
    hass.data[DOMAIN][DATA_RENDER_SEMAPHORE] = asyncio.Semaphore(
        runtime_config[CONF_MAX_CONCURRENT_RENDERS]
    )
    async_register_views(hass)

    _LOGGER.info(
        "Grafana Image backend started for %s (token configured: %s, cache_seconds: %s, max_concurrent_renders: %s, timeout_seconds: %s)",
        runtime_config[CONF_URL],
        bool(runtime_config.get(CONF_API_TOKEN)),
        runtime_config[CONF_CACHE_SECONDS],
        runtime_config[CONF_MAX_CONCURRENT_RENDERS],
        runtime_config[CONF_TIMEOUT_SECONDS],
    )
    hass.async_create_task(_async_probe_grafana(hass))
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
