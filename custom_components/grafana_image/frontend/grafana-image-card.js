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

function buildImageUrl(config, nowMs = Date.now()) {
  const normalized = normalizeConfig(config);
  const url = new URL("/api/grafana_image/render", "http://homeassistant.local");

  url.searchParams.set("dashboard_uid", normalized.dashboard_uid);
  url.searchParams.set("panel_id", String(normalized.panel_id));
  url.searchParams.set("from", normalized.from);
  url.searchParams.set("to", normalized.to);
  url.searchParams.set("slug", normalized.slug);
  url.searchParams.set("org_id", String(normalized.org_id));
  url.searchParams.set("theme", normalized.theme);
  url.searchParams.set("width", String(normalized.width));
  url.searchParams.set("height", String(normalized.height));
  url.searchParams.set("t", String(computeRefreshBucket(normalized.refresh_seconds, nowMs)));

  return `${url.pathname}${url.search}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CONFIG,
    buildImageUrl,
    computeRefreshBucket,
    normalizeConfig,
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
    }

    setConfig(config) {
      this._config = normalizeConfig(config);
      this.render();
      this._restartRefreshTimer();
      this._updateImage();
    }

    set hass(hass) {
      this._hass = hass;
    }

    disconnectedCallback() {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = undefined;
      }
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

      this._image = document.createElement("img");
      this._image.alt = this._config.title || "Grafana panel image";
      this._image.addEventListener("load", () => this._setError(""));
      this._image.addEventListener("error", () => this._setError("Grafana image failed to load"));

      this._error = document.createElement("div");
      this._error.className = "error";
      this._error.hidden = true;

      wrapper.appendChild(this._image);
      content.appendChild(wrapper);
      content.appendChild(this._error);
      this._card.appendChild(content);
      this.shadowRoot.appendChild(this._card);
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

    _updateImage() {
      if (!this._image) {
        return;
      }

      this._lastBucket = computeRefreshBucket(this._config.refresh_seconds);
      this._setError("");
      this._image.style.objectFit = this._config.fit;
      this._image.src = buildImageUrl(this._config);
    }

    _setError(message) {
      if (!this._error) {
        return;
      }

      this._error.textContent = message;
      this._error.hidden = !message;
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
