const DEFAULT_CONFIG = {
  slug: "_",
  org_id: 1,
  theme: "dark",
  width: 900,
  height: 320,
  refresh_seconds: 60,
  fit: "contain",
};

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

function resolveRenderDimensions(config, measuredWidth) {
  const normalized = normalizeConfig(config);
  const fallbackWidth = Math.max(100, Number(normalized.width) || DEFAULT_CONFIG.width);
  const configuredHeight = Math.max(100, Number(normalized.height) || DEFAULT_CONFIG.height);
  const effectiveWidth = Math.max(100, Math.round(Number(measuredWidth) || fallbackWidth));
  const effectiveHeight = configuredHeight;

  return {
    width: effectiveWidth,
    height: effectiveHeight,
  };
}

function buildImageUrl(config, nowMs = Date.now(), measuredWidth) {
  const normalized = normalizeConfig(config);
  const dimensions = resolveRenderDimensions(normalized, measuredWidth);
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
    buildImageUrl,
    computeRefreshBucket,
    getAuthorizationHeader,
    normalizeConfig,
    resolveRenderDimensions,
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
      return 3;
    }

    render() {
      if (!this._config || !this.shadowRoot) {
        return;
      }

      this.shadowRoot.innerHTML = `
        <style>
          .card-content {
            padding: 16px;
          }

          .image-wrapper {
            position: relative;
          }

          img {
            width: 100%;
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

      const requestId = ++this._loadRequestId;
      this._lastBucket = computeRefreshBucket(this._config.refresh_seconds);
      this._setError("");
      this._image.style.objectFit = this._config.fit;

      try {
        const measuredWidth = this._getMeasuredWidth();
        if (!measuredWidth) {
          return;
        }

        const imageUrl = buildImageUrl(this._config, Date.now(), measuredWidth);
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
        if (!width || width === this._renderWidth) {
          return;
        }

        this._renderWidth = width;
        if (this._config && this._image) {
          this._updateImage();
        }
      });

      this._resizeObserver.observe(this._wrapper);
    }

    _getMeasuredWidth() {
      if (this._renderWidth) {
        return this._renderWidth;
      }

      const width = Math.round(this._wrapper?.getBoundingClientRect?.().width || 0);
      return width || undefined;
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
