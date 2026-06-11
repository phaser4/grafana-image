"""Constants for the Grafana Image integration."""

DOMAIN = "grafana_image"

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
DEFAULT_REFRESH_SECONDS = 60
DEFAULT_FIT = "contain"

DATA_CONFIG = "config"
DATA_CACHE = "cache"

RENDER_PATH = "/api/grafana_image/render"
STATIC_PATH = "/api/grafana_image/static/grafana-image-card.js"
