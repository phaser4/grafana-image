"""The Grafana Image integration."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from .const import (
    CONF_API_TOKEN,
    CONF_CACHE_SECONDS,
    CONF_TIMEOUT_SECONDS,
    CONF_URL,
    DEFAULT_CACHE_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    DOMAIN,
)
from .runtime import build_runtime_state
from .views import async_register_views

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
    async_register_views(hass)
    return True
