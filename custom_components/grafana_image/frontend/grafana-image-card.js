const DEFAULT_CONFIG = {
  slug: "_",
  org_id: 1,
  theme: "dark",
  width: 900,
  rows: 3,
  columns: 12,
  refresh_seconds: 600,
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

function buildStatusUrl(config, measuredWidth, measuredHeight) {
  const normalized = normalizeConfig(config);
  const dimensions = resolveRenderDimensions(normalized, measuredWidth, measuredHeight);
  const url = new URL("/api/grafana_image/status", "http://homeassistant.local");

  url.searchParams.set("dashboard_uid", normalized.dashboard_uid);
  url.searchParams.set("panel_id", String(normalized.panel_id));
  url.searchParams.set("from", normalized.from);
  url.searchParams.set("to", normalized.to);
  url.searchParams.set("slug", normalized.slug);
  url.searchParams.set("org_id", String(normalized.org_id));
  url.searchParams.set("theme", normalized.theme);
  url.searchParams.set("width", String(dimensions.width));
  url.searchParams.set("height", String(dimensions.height));
  url.searchParams.set("refresh_seconds", String(normalized.refresh_seconds));

  return `${url.pathname}${url.search}`;
}

function buildImageUrl(config, cacheToken, measuredWidth, measuredHeight) {
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
  url.searchParams.set("refresh_seconds", String(normalized.refresh_seconds));
  if (cacheToken) {
    url.searchParams.set("v", String(cacheToken));
  }

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

function formatAgeLabel(lastRenderedAt, nowMs = Date.now()) {
  if (!lastRenderedAt) {
    return "";
  }

  const renderedAtMs = Date.parse(lastRenderedAt);
  if (Number.isNaN(renderedAtMs)) {
    return "";
  }

  const ageSeconds = Math.max(0, Math.floor((nowMs - renderedAtMs) / 1000));
  if (ageSeconds < 60) {
    return `age: ${ageSeconds}s`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) {
    return `age: ${ageMinutes}m`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `age: ${ageHours}h`;
  }

  return `age: ${Math.floor(ageHours / 24)}d`;
}

function resolveAuthContext(hass) {
  return hass?.connection?.options?.auth ?? hass?.auth;
}

function resolveAccessToken(hass) {
  const auth = resolveAuthContext(hass);

  return (
    auth?.accessToken ??
    auth?.data?.access_token ??
    auth?.data?.accessToken ??
    hass?.auth?.accessToken ??
    hass?.auth?.data?.access_token ??
    hass?.auth?.data?.accessToken
  );
}

async function fetchBackend(hass, url, init = {}) {
  const auth = resolveAuthContext(hass);
  const requestInit = {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  };

  const withToken = (token) => ({
    ...requestInit,
    headers: {
      ...(requestInit.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  let token = resolveAccessToken(hass);
  if (!token && auth?.refreshAccessToken) {
    await auth.refreshAccessToken();
    token = resolveAccessToken(hass);
  }

  if (!token) {
    throw new Error("Home Assistant access token is not available");
  }

  let response = await fetch(url, withToken(token));
  if (response.status !== 401 || !auth?.refreshAccessToken) {
    return response;
  }

  await auth.refreshAccessToken();
  const refreshedToken = resolveAccessToken(hass);
  if (!refreshedToken) {
    return response;
  }

  response = await fetch(url, withToken(refreshedToken));
  return response;
}

function resolvePlaceholderMessage(status, fallbackMessage = "Grafana image unavailable") {
  if (!status) {
    return fallbackMessage;
  }

  if (status.status === "queued") {
    return status.message || "Image render queued";
  }
  if (status.status === "rendering") {
    return status.message || "Rendering image...";
  }
  if (status.status === "error") {
    return status.message || status.last_error || fallbackMessage;
  }
  if (status.status === "stale" && !status.has_cached_image) {
    return status.message || "Refreshing image...";
  }

  return fallbackMessage;
}

async function readErrorMessage(response, fallbackMessage) {
  try {
    const data = await response.json();
    if (data && typeof data.message === "string" && data.message.trim()) {
      return data.message.trim();
    }
  } catch (_error) {
    // Ignore JSON parse failures and use the fallback message.
  }

  return fallbackMessage;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CONFIG,
    GRID_COLUMN_COUNT,
    MIN_FETCH_INTERVAL_MS,
    buildImageUrl,
    buildStatusUrl,
    computeCardSize,
    computeRefreshBucket,
    fetchBackend,
    formatAgeLabel,
    normalizeConfig,
    readErrorMessage,
    resolveAccessToken,
    resolveAuthContext,
    resolveCardHeight,
    resolveCardColumns,
    resolveCardRows,
    resolveFallbackRenderHeight,
    resolveGridOptions,
    resolvePlaceholderMessage,
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
      this._placeholder = undefined;
      this._loadRequestId = 0;
      this._resizeObserver = undefined;
      this._status = undefined;
      this._statusPollTimer = undefined;
      this._renderWidth = undefined;
      this._renderHeight = undefined;
      this._lastRequestedUrl = undefined;
      this._lastFetchAt = 0;
      this._ageBadge = undefined;
      this._lastRenderedAt = undefined;
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
      if (this._statusPollTimer) {
        clearTimeout(this._statusPollTimer);
        this._statusPollTimer = undefined;
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
            overflow: hidden;
            background: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
          }

          img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: ${this._config.fit};
          }

          img[hidden] {
            display: none;
          }

          .placeholder {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
            text-align: center;
            color: var(--secondary-text-color);
            line-height: 1.4;
            white-space: pre-wrap;
          }

          .age-badge {
            position: absolute;
            top: 6px;
            right: 8px;
            color: var(--secondary-text-color);
            font-size: 0.65rem;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.18);
            z-index: 1;
            pointer-events: none;
          }

          .age-badge[hidden] {
            display: none;
          }

          .placeholder[hidden] {
            display: none;
          }

          .error {
            color: var(--error-color);
            padding: 16px;
          }

          .status {
            color: var(--secondary-text-color);
            font-size: 0.9rem;
            padding: 16px 0 0;
          }

          .status[hidden],
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
      this._image.alt = "";

      this._placeholder = document.createElement("div");
      this._placeholder.className = "placeholder";
      this._placeholder.hidden = true;

      this._ageBadge = document.createElement("div");
      this._ageBadge.className = "age-badge";
      this._ageBadge.hidden = true;

      this._error = document.createElement("div");
      this._error.className = "error";
      this._error.hidden = true;

      this._status = document.createElement("div");
      this._status.className = "status";
      this._status.hidden = true;

      wrapper.appendChild(this._image);
      wrapper.appendChild(this._ageBadge);
      wrapper.appendChild(this._placeholder);
      content.appendChild(wrapper);
      content.appendChild(this._status);
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
        this._refreshAgeBadge();
        const nextBucket = computeRefreshBucket(this._config.refresh_seconds);
        if (nextBucket !== this._lastBucket) {
          this._updateImage(true);
        }
      }, intervalMs);
    }

    async _updateImage(forceStatusCheck = false) {
      if (!this._image || !this._hass) {
        return;
      }

      this._clearStatusPoll();
      let requestId = 0;
      try {
        const { width: measuredWidth, height: measuredHeight } = this._getMeasuredDimensions();
        if (!measuredWidth || !measuredHeight) {
          return;
        }

        const nowMs = Date.now();
        const nextBucket = computeRefreshBucket(this._config.refresh_seconds, nowMs);
        if (!forceStatusCheck && nextBucket === this._lastBucket && this._statusPollTimer) {
          return;
        }

        requestId = ++this._loadRequestId;
        this._setError("");
        const statusResponse = await fetchBackend(
          this._hass,
          buildStatusUrl(this._config, measuredWidth, measuredHeight),
        );

        if (!statusResponse.ok) {
          const statusMessage = await readErrorMessage(
            statusResponse,
            `Status request failed with status ${statusResponse.status}`,
          );
          console.warn("Grafana Image status request failed", {
            status: statusResponse.status,
          });
          throw new Error(statusMessage);
        }

        const status = await statusResponse.json();
        if (requestId !== this._loadRequestId) {
          return;
        }

        this._lastBucket = nextBucket;
        this._setStatus(status.status === "ready" ? "" : (status.message || ""));
        if (status.status === "error" && !status.has_cached_image) {
          this._setError(status.message || "Grafana image failed to load");
        }
        this._setAge(status.has_cached_image ? status.last_rendered_at : "");

        if (status.has_cached_image && status.cache_token) {
          await this._loadCachedImage(requestId, status.cache_token, measuredWidth, measuredHeight, nowMs);
        } else {
          this._revokeImageUrl();
          this._image.removeAttribute("src");
          this._setImageVisible(false);
          this._setPlaceholder(resolvePlaceholderMessage(status));
        }

        this._scheduleStatusPoll(status);
      } catch (_error) {
        if (requestId !== this._loadRequestId) {
          return;
        }

        console.warn("Grafana Image could not load panel image", {
          error: _error instanceof Error ? _error.message : _error,
          dashboard_uid: this._config.dashboard_uid,
          panel_id: this._config.panel_id,
        });
        this._lastRequestedUrl = undefined;
        this._lastFetchAt = 0;
        this._setStatus("");
        this._revokeImageUrl();
        this._image.removeAttribute("src");
        this._setImageVisible(false);
        this._setPlaceholder(_error instanceof Error ? _error.message : "Grafana image failed to load");
        this._setError(_error instanceof Error ? _error.message : "Grafana image failed to load");
        this._statusPollTimer = setTimeout(() => {
          this._statusPollTimer = undefined;
          this._updateImage(true);
        }, 5000);
      }
    }

    async _loadCachedImage(requestId, cacheToken, measuredWidth, measuredHeight, nowMs) {
      const imageUrl = buildImageUrl(this._config, cacheToken, measuredWidth, measuredHeight);
      if (!shouldFetchImage(imageUrl, this._lastRequestedUrl, this._lastFetchAt, nowMs)) {
        return;
      }

      this._lastRequestedUrl = imageUrl;
      this._lastFetchAt = nowMs;
      this._image.style.objectFit = this._config.fit;

      const response = await fetchBackend(this._hass, imageUrl);

      if (!response.ok) {
        console.warn("Grafana Image cached image request failed", {
          status: response.status,
          url: imageUrl,
        });
        throw new Error(
          await readErrorMessage(response, `Cached image request failed with status ${response.status}`),
        );
      }

      const blob = await response.blob();
      if (requestId !== this._loadRequestId) {
        return;
      }

      this._revokeImageUrl();
      this._imageUrl = URL.createObjectURL(blob);
      this._image.src = this._imageUrl;
      this._setImageVisible(true);
      this._setPlaceholder("");
      this._refreshAgeBadge();
    }

    _setError(message) {
      if (!this._error) {
        return;
      }

      this._error.textContent = message;
      this._error.hidden = !message;
    }

    _setStatus(message) {
      if (!this._status) {
        return;
      }

      this._status.textContent = message;
      this._status.hidden = !message;
    }

    _setPlaceholder(message) {
      if (!this._placeholder) {
        return;
      }

      this._placeholder.textContent = message;
      this._placeholder.hidden = !message;
    }

    _setImageVisible(isVisible) {
      if (!this._image) {
        return;
      }

      this._image.hidden = !isVisible;
      if (!isVisible) {
        this._setAge("");
      }
    }

    _setAge(lastRenderedAt) {
      this._lastRenderedAt = lastRenderedAt || undefined;
      this._refreshAgeBadge();
    }

    _refreshAgeBadge(nowMs = Date.now()) {
      if (!this._ageBadge) {
        return;
      }

      const label = formatAgeLabel(this._lastRenderedAt, nowMs);
      this._ageBadge.textContent = label;
      this._ageBadge.hidden = !label || !!this._image?.hidden;
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
          this._updateImage(true);
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

    _scheduleStatusPoll(status) {
      this._clearStatusPoll();
      if (!status || status.status === "ready") {
        return;
      }

      const pollAfterMs = Math.max(500, Number(status.poll_after_ms) || 2000);
      this._statusPollTimer = setTimeout(() => {
        this._statusPollTimer = undefined;
        this._updateImage(true);
      }, pollAfterMs);
    }

    _clearStatusPoll() {
      if (!this._statusPollTimer) {
        return;
      }

      clearTimeout(this._statusPollTimer);
      this._statusPollTimer = undefined;
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
