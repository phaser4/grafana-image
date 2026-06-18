const DEFAULT_CONFIG = {
  slug: "_",
  org_id: 1,
  theme: "dark",
  width: 900,
  rows: 3,
  columns: 12,
  refresh_seconds: 60,
  fit: "contain",
};
const MIN_FETCH_INTERVAL_MS = 30000;
const GRID_COLUMN_COUNT = 12;
const SECTION_ROW_HEIGHT_PX = 56;
const SECTION_ROW_GAP_PX = 8;
const CARD_CONTENT_PADDING_PX = 32;
const CARD_HEADER_ESTIMATE_PX = 40;

function validateRequiredConfig(config) {
  const requiredFields = ["dashboard_uid", "panel_id", "from", "to"];

  for (const field of requiredFields) {
    if (!(field in config) || config[field] === undefined || config[field] === null || `${config[field]}`.trim() === "") {
      throw new Error(`Missing required config field: ${field}`);
    }
  }
}

function normalizeConfig(config) {
  validateRequiredConfig(config);

  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

function computeRefreshBucket(refreshSeconds, nowMs = Date.now()) {
  const safeRefreshSeconds = Math.max(1, Number(refreshSeconds) || DEFAULT_CONFIG.refresh_seconds);
  return Math.floor(nowMs / (safeRefreshSeconds * 1000));
}

function resolveCardRows(config) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(config || {}),
  };
  const parsedRows = Number(merged.rows);
  const safeRows = Number.isFinite(parsedRows) ? parsedRows : DEFAULT_CONFIG.rows;

  return Math.max(1, Math.round(safeRows));
}

function resolveCardColumns(config) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(config || {}),
  };

  if (merged.columns === "full") {
    return "full";
  }
  const parsedColumns = Number(merged.columns);
  const safeColumns = Number.isFinite(parsedColumns) ? parsedColumns : DEFAULT_CONFIG.columns;

  return Math.max(1, Math.min(GRID_COLUMN_COUNT, Math.round(safeColumns)));
}

function resolveFallbackRenderHeight(config) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(config || {}),
  };
  const verticalChrome = CARD_CONTENT_PADDING_PX + (merged.title ? CARD_HEADER_ESTIMATE_PX : 0);

  return Math.max(1, resolveCardHeight(merged) - verticalChrome);
}

function resolveCardHeight(config) {
  const rows = resolveCardRows(config);

  return rows * SECTION_ROW_HEIGHT_PX + Math.max(0, rows - 1) * SECTION_ROW_GAP_PX;
}

function resolveGridOptions(config) {
  const rows = resolveCardRows(config);
  const columns = resolveCardColumns(config);

  return {
    rows,
    columns,
    min_rows: rows,
    max_rows: rows,
    min_columns: columns === "full" ? 1 : columns,
    max_columns: columns === "full" ? undefined : columns,
  };
}

function computeCardSize(config) {
  return Math.max(1, Math.ceil(resolveCardHeight(config) / 50));
}

function resolveRenderDimensions(config, measuredWidth, measuredHeight) {
  const normalized = normalizeConfig(config);
  const fallbackWidth = Math.max(100, Number(normalized.width) || DEFAULT_CONFIG.width);
  const effectiveWidth = Math.max(100, Math.round(Number(measuredWidth) || fallbackWidth));
  const effectiveHeight = Math.max(1, Math.round(Number(measuredHeight) || resolveFallbackRenderHeight(normalized)));

  return {
    width: effectiveWidth,
    height: effectiveHeight,
  };
}

function buildImageUrl(config, nowMs = Date.now(), measuredWidth, measuredHeight) {
  const normalized = normalizeConfig(config);
  const dimensions = resolveRenderDimensions(normalized, measuredWidth, measuredHeight);
  const url = new URL("/api/grafana_image/render", "http://homeassistant.local");

  url.searchParams.set("dashboard_uid", normalized.dashboard_uid);
  url.searchParams.set("panel_id", String(normalized.panel_id));
  url.searchParams.set("from", normalized.from);
  url.searchParams.set("to", normalized.to);
  url.searchParams.set("slug", normalized.slug);
  url.searchParams.set("org_id", String(normalized.org_id));
  url.searchParams.set("theme", normalized.theme);
  url.searchParams.set("width", String(dimensions.width));
  url.searchParams.set("height", String(dimensions.height));
  url.searchParams.set("t", String(computeRefreshBucket(normalized.refresh_seconds, nowMs)));

  return `${url.pathname}${url.search}`;
}

function shouldFetchImage(nextUrl, lastUrl, lastFetchAt, nowMs = Date.now(), minIntervalMs = MIN_FETCH_INTERVAL_MS) {
  if (!nextUrl) {
    return false;
  }

  if (!lastUrl || nextUrl !== lastUrl) {
    return true;
  }

  return nowMs - lastFetchAt >= minIntervalMs;
}

function getAuthorizationHeader(hass) {
  const token = hass?.auth?.data?.access_token ?? hass?.auth?.data?.accessToken;
  if (!token) {
    throw new Error("Home Assistant access token is not available");
  }

  return `Bearer ${token}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CONFIG,
    GRID_COLUMN_COUNT,
    MIN_FETCH_INTERVAL_MS,
    buildImageUrl,
    computeCardSize,
    computeRefreshBucket,
    getAuthorizationHeader,
    normalizeConfig,
    resolveCardHeight,
    resolveCardColumns,
    resolveCardRows,
    resolveFallbackRenderHeight,
    resolveGridOptions,
    resolveRenderDimensions,
    shouldFetchImage,
    validateRequiredConfig,
  };
}

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class GrafanaImageCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._refreshTimer = undefined;
      this._lastBucket = undefined;
      this._image = undefined;
      this._error = undefined;
      this._card = undefined;
      this._wrapper = undefined;
      this._imageUrl = undefined;
      this._loadRequestId = 0;
      this._resizeObserver = undefined;
      this._renderWidth = undefined;
      this._renderHeight = undefined;
      this._lastRequestedUrl = undefined;
      this._lastFetchAt = 0;
    }

    setConfig(config) {
      this._config = normalizeConfig(config);
      this.render();
      this._restartRefreshTimer();
      this._updateImage();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._config && this._image) {
        this._updateImage();
      }
    }

    disconnectedCallback() {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = undefined;
      }

      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = undefined;
      }

      this._revokeImageUrl();
    }

    getCardSize() {
      return computeCardSize(this._config);
    }

    getGridOptions() {
      return resolveGridOptions(this._config);
    }

    render() {
      if (!this._config || !this.shadowRoot) {
        return;
      }
      const resolvedCardHeight = resolveCardHeight(this._config);
      const fallbackRenderHeight = resolveFallbackRenderHeight(this._config);

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
          }

          ha-card {
            height: ${resolvedCardHeight}px;
            overflow: hidden;
          }

          .card-content {
            padding: 16px;
            box-sizing: border-box;
          }

          .image-wrapper {
            position: relative;
            height: ${fallbackRenderHeight}px;
          }

          img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: ${this._config.fit};
          }

          .error {
            color: var(--error-color);
            padding: 16px;
          }

          .error[hidden] {
            display: none;
          }
        </style>
      `;

      this._card = document.createElement("ha-card");
      if (this._config.title) {
        this._card.setAttribute("header", this._config.title);
      }

      const content = document.createElement("div");
      content.className = "card-content";

      const wrapper = document.createElement("div");
      wrapper.className = "image-wrapper";
      this._wrapper = wrapper;

      this._image = document.createElement("img");
      this._image.alt = this._config.title || "Grafana panel image";

      this._error = document.createElement("div");
      this._error.className = "error";
      this._error.hidden = true;

      wrapper.appendChild(this._image);
      content.appendChild(wrapper);
      content.appendChild(this._error);
      this._card.appendChild(content);
      this.shadowRoot.appendChild(this._card);

      this._observeSize();
    }

    _restartRefreshTimer() {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
      }

      const intervalMs = 1000;
      this._refreshTimer = setInterval(() => {
        const nextBucket = computeRefreshBucket(this._config.refresh_seconds);
        if (nextBucket !== this._lastBucket) {
          this._updateImage();
        }
      }, intervalMs);
    }

    async _updateImage() {
      if (!this._image || !this._hass) {
        return;
      }

      let requestId = 0;
      try {
        const { width: measuredWidth, height: measuredHeight } = this._getMeasuredDimensions();
        if (!measuredWidth || !measuredHeight) {
          return;
        }

        const nowMs = Date.now();
        const imageUrl = buildImageUrl(this._config, nowMs, measuredWidth, measuredHeight);
        if (!shouldFetchImage(imageUrl, this._lastRequestedUrl, this._lastFetchAt, nowMs)) {
          return;
        }

        requestId = ++this._loadRequestId;
        this._lastBucket = computeRefreshBucket(this._config.refresh_seconds, nowMs);
        this._lastRequestedUrl = imageUrl;
        this._lastFetchAt = nowMs;
        this._setError("");
        this._image.style.objectFit = this._config.fit;

        const response = await fetch(imageUrl, {
          headers: {
            Authorization: getAuthorizationHeader(this._hass),
          },
        });

        if (!response.ok) {
          console.warn("Grafana Image render request failed", {
            status: response.status,
            url: imageUrl,
          });
          throw new Error(`Render request failed with status ${response.status}`);
        }

        const blob = await response.blob();
        if (requestId !== this._loadRequestId) {
          return;
        }

        this._revokeImageUrl();
        this._imageUrl = URL.createObjectURL(blob);
        this._image.src = this._imageUrl;
      } catch (_error) {
        if (requestId !== this._loadRequestId) {
          return;
        }

        console.warn("Grafana Image could not load panel image", {
          error: _error instanceof Error ? _error.message : _error,
          dashboard_uid: this._config.dashboard_uid,
          panel_id: this._config.panel_id,
        });
        this._revokeImageUrl();
        this._image.removeAttribute("src");
        this._setError("Grafana image failed to load");
      }
    }

    _setError(message) {
      if (!this._error) {
        return;
      }

      this._error.textContent = message;
      this._error.hidden = !message;
    }

    _revokeImageUrl() {
      if (!this._imageUrl) {
        return;
      }

      URL.revokeObjectURL(this._imageUrl);
      this._imageUrl = undefined;
    }

    _observeSize() {
      if (!this._wrapper || typeof ResizeObserver === "undefined") {
        return;
      }

      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
      }

      this._resizeObserver = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect?.width || 0);
        const height = Math.round(entries[0]?.contentRect?.height || 0);
        if ((!width || width === this._renderWidth) && (!height || height === this._renderHeight)) {
          return;
        }

        this._renderWidth = width;
        this._renderHeight = height;
        if (this._config && this._image) {
          this._updateImage();
        }
      });

      this._resizeObserver.observe(this._wrapper);
    }

    _getMeasuredDimensions() {
      if (this._renderWidth && this._renderHeight) {
        return {
          width: this._renderWidth,
          height: this._renderHeight,
        };
      }

      const rect = this._wrapper?.getBoundingClientRect?.();

      return {
        width: Math.round(rect?.width || 0) || undefined,
        height: Math.round(rect?.height || 0) || undefined,
      };
    }
  }

  if (!customElements.get("grafana-image-card")) {
    customElements.define("grafana-image-card", GrafanaImageCard);
  }
}

if (typeof window !== "undefined") {
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "grafana-image-card",
    name: "Grafana Image",
    description: "Shows a Grafana panel image through a Home Assistant backend proxy.",
  });
}
