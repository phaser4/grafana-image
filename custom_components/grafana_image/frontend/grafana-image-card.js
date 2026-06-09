class GrafanaImageCard extends HTMLElement {
  setConfig(config) {
    const requiredFields = ["dashboard_uid", "panel_id", "from", "to"];

    for (const field of requiredFields) {
      if (!(field in config)) {
        throw new Error(`Missing required config field: ${field}`);
      }
    }

    this._config = {
      slug: "_",
      org_id: 1,
      theme: "dark",
      width: 900,
      height: 320,
      refresh_seconds: 60,
      fit: "contain",
      ...config,
    };

    this.render();
  }

  set hass(_hass) {
    this._hass = _hass;
  }

  getCardSize() {
    return 3;
  }

  render() {
    if (!this._config) {
      return;
    }

    const title = this._config.title || "Grafana Image";

    this.innerHTML = `
      <ha-card header="${this.escapeHtml(title)}">
        <div class="card-content">
          <p>This is the initial Grafana Image scaffold.</p>
          <p>The render proxy and image loading flow are not implemented yet.</p>
          <p><strong>Dashboard UID:</strong> ${this.escapeHtml(String(this._config.dashboard_uid))}</p>
          <p><strong>Panel ID:</strong> ${this.escapeHtml(String(this._config.panel_id))}</p>
        </div>
      </ha-card>
    `;
  }

  escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

if (!customElements.get("grafana-image-card")) {
  customElements.define("grafana-image-card", GrafanaImageCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "grafana-image-card",
  name: "Grafana Image",
  description: "Shows a Grafana panel image through a Home Assistant backend proxy.",
});
