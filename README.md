# Grafana Image

Grafana Image is a Home Assistant custom integration and Lovelace custom card for showing a rendered Grafana panel as an image inside a Home Assistant dashboard.

The browser never calls Grafana directly. Instead, the Lovelace card requests the image from a Home Assistant backend endpoint, and Home Assistant proxies the request to Grafana. This keeps Grafana credentials server-side.

## Requirements

- Home Assistant with support for custom integrations
- Grafana reachable from the Home Assistant host or container
- Grafana image rendering enabled and working
- Either:
  - a Grafana API token with access to the dashboard and panel, or
  - anonymous Grafana access configured for the target dashboards

## Installation With HACS

1. Open HACS in Home Assistant.
2. Add this repository as a custom repository:
   - Repository: `https://github.com/phaser4/grafana-image`
   - Category: `Integration`
3. Install `Grafana Image`.
4. Restart Home Assistant.

## Configuration

Add the integration to `configuration.yaml`:

```yaml
grafana_image:
  url: "http://grafana.local:3000"
  api_token: !secret grafana_api_token
  cache_seconds: 60
  timeout_seconds: 20
```

### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | yes | none | Base Grafana URL reachable from Home Assistant |
| `api_token` | no | none | Bearer token for Grafana API access |
| `cache_seconds` | no | `60` | In-memory cache duration for rendered PNGs |
| `timeout_seconds` | no | `20` | Timeout for upstream Grafana render requests |

### How to get a Grafana token

If you do not use anonymous Grafana access, create a Grafana service account token:

1. Sign in to Grafana with an account that can manage service accounts.
2. Open `Administration`.
3. Open `Users and access` -> `Service accounts`.
4. Click `Add service account`.
5. Create a service account such as `home-assistant-grafana-image`.
6. Open that service account and click `Add service account token`.
7. Generate the token and copy it immediately.
8. Store it in Home Assistant, for example:

```yaml
grafana_image:
  url: "http://grafana.local:3000"
  api_token: !secret grafana_api_token
```

And in `secrets.yaml`:

```yaml
grafana_api_token: your_generated_token_here
```

For this integration, a read-only role such as `Viewer` is the safest starting point.

## Register the Lovelace Resource

Add the card resource manually:

```yaml
resources:
  - url: /api/grafana_image/static/grafana-image-card.js
    type: module
```

Or in the Home Assistant UI:

1. Open `Settings`
2. Open `Dashboards`
3. Open `Resources`
4. Add:
   - URL: `/api/grafana_image/static/grafana-image-card.js`
   - Type: `JavaScript module`

## Card Configuration

### Minimal example

```yaml
type: custom:grafana-image-card
dashboard_uid: aquarium
panel_id: 4
from: now-24h
to: now
```

### Full example

```yaml
type: custom:grafana-image-card
dashboard_uid: aquarium
panel_id: 4
from: now-24h
to: now
slug: aquarium
org_id: 1
theme: dark
refresh_seconds: 60
fit: contain
```

### Card options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `dashboard_uid` | yes | none | Grafana dashboard UID |
| `panel_id` | yes | none | Grafana panel ID |
| `from` | yes | none | Grafana time range start |
| `to` | yes | none | Grafana time range end |
| `title` | no | none | Home Assistant card header |
| `slug` | no | `_` | Cosmetic dashboard slug used in the render URL |
| `org_id` | no | `1` | Grafana organization ID |
| `theme` | no | `dark` | Grafana render theme |
| `width` | no | `900` | Fallback render width used until the card can measure its real width |
| `height` | no | `320` | Render height in pixels, which also controls the card's displayed height |
| `refresh_seconds` | no | `60` | Auto-refresh interval for the image |
| `fit` | no | `contain` | CSS `object-fit` value for the image |

## How It Works

The card requests:

```text
/api/grafana_image/render?dashboard_uid=...&panel_id=...&from=...&to=...
```

Home Assistant then calls Grafana using the configured base URL and optional bearer token, requests the rendered PNG, and returns the image to the card.

Successful PNG responses are cached in memory based on the effective render parameters.

The card measures its actual rendered width and asks Grafana for an image at that width. It keeps the configured `height` as the chart height, and it scales the render request for high-DPI displays so labels stay readable.

## Troubleshooting

### Grafana image renderer is not configured

If the card shows backend errors or Grafana does not return PNGs, verify that Grafana image rendering is installed and working for panel renders.

### Home Assistant cannot reach Grafana

Use a Grafana URL that is reachable from the Home Assistant environment, not just from your desktop browser. Docker and container setups often require a container hostname rather than `localhost`.

### `401` or `403` from Grafana

Verify that:

- the API token is valid
- the token has access to the dashboard
- anonymous access is configured if you are not using a token

### Mixed network or Docker hostname issues

If Grafana works in a browser but not through Home Assistant, the hostname is often the problem. Test with the hostname as seen from the Home Assistant container or VM.

### Slow rendering

If renders are slow:

- increase `timeout_seconds`
- lower the refresh frequency
- reduce `width` and `height`
- verify that Grafana rendering is healthy

## Security Notes

- Do not expose the Grafana API token in Lovelace config.
- Do not expose Grafana anonymously outside a trusted network unless it is otherwise protected.
- The card does not accept a Grafana base URL, which prevents browser-side credential leaks and arbitrary upstream requests.
