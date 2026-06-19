"""Constants for the Grafana Image integration."""

DOMAIN = "grafana_image"

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
DEFAULT_FIT = "contain"

DATA_CONFIG = "config"
DATA_CACHE = "cache"
DATA_CACHE_DIR = "cache_dir"
DATA_QUEUED_KEYS = "queued_keys"
DATA_RENDER_EVENT = "render_event"
DATA_RENDER_QUEUE = "render_queue"
DATA_RENDER_STATES = "render_states"
DATA_RENDER_TASK = "render_task"
DATA_REFRESH_TASK = "refresh_task"

RENDER_PATH = "/api/grafana_image/render"
STATUS_PATH = "/api/grafana_image/status"
STATIC_PATH = "/api/grafana_image/static/grafana-image-card.js"
