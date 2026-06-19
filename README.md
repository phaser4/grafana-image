# Grafana Image

Grafana Image is a Home Assistant custom integration and Lovelace custom card for showing a rendered Grafana panel as an image inside a Home Assistant dashboard.

The browser never calls Grafana directly. Instead, the Lovelace card requests the image from a Home Assistant backend endpoint, and Home Assistant proxies the request to Grafana. This keeps Grafana credentials server-side.

Rendered images are now produced by a single background worker and kept in backend cache. The card first asks the backend for cache or queue status, then loads the cached PNG when one is available.

Once a panel has rendered successfully, the integration keeps showing that last successful image even when it is stale. The last cached image is also persisted so it can be restored after a Home Assistant restart.

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
  max_concurrent_renders: 2
  timeout_seconds: 20
```

### Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | yes | none | Base Grafana URL reachable from Home Assistant |
| `api_token` | no | none | Bearer token for Grafana API access |
| `cache_seconds` | no | `60` | In-memory cache duration for rendered PNGs |
| `max_concurrent_renders` | no | `2` | Retained for backward compatibility; renders are currently processed one at a time by the background worker |
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
columns: 12
rows: 3
refresh_seconds: 600
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
| `width` | no | `900` | Fallback width used only before the card can measure its real width |
| `columns` | no | `12` | Default section-grid width for the card; accepts `1` to `12` or `full` |
| `rows` | no | `3` | Default card height in Lovelace row units |
| `refresh_seconds` | no | `600` | Background re-render interval for the image; cards can override it per panel |
| `fit` | no | `contain` | CSS `object-fit` value for the image |

## How It Works

The card first requests status:

```text
/api/grafana_image/status?dashboard_uid=...&panel_id=...&from=...&to=...
```

The backend then:

- checks whether a recent cached PNG already exists
- returns `ready`, `stale`, `queued`, `rendering`, or `error`
- queues the render key for the single background worker when the image is older than `refresh_seconds`
- keeps previously rendered panels refreshing in the backend even while no dashboard is open

When a cached PNG is available, the card then requests:

```text
/api/grafana_image/render?dashboard_uid=...&panel_id=...&from=...&to=...
```

The render endpoint serves only cached PNGs. It does not do long synchronous Grafana renders on cache miss anymore.

Successful PNG responses are cached based on the effective render parameters. If a stale image exists, the card keeps showing it while the worker refreshes it in the background. If no previous image exists yet, the card shows that rendering is queued.

The integration also persists the last successful image for each render key, so after a restart it can immediately show the previous image while a new background refresh is queued.

By default, the integration re-renders a panel every `10` minutes. Override `refresh_seconds` on a card when a panel should refresh faster or slower.

The card reports Lovelace grid sizing through `columns` and `rows`, with defaults of a full-width `12 x 3` card. It then measures the actual rendered image area inside the card and asks Grafana for a PNG at that exact width and height, so the image matches the displayed card size without browser-side upscaling or downscaling.

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
- remember the integration now renders one image at a time in the background
- lower the refresh frequency
- reduce `rows` or the section width
- verify that Grafana rendering is healthy

## Security Notes

- Do not expose the Grafana API token in Lovelace config.
- Do not expose Grafana anonymously outside a trusted network unless it is otherwise protected.
- The card does not accept a Grafana base URL, which prevents browser-side credential leaks and arbitrary upstream requests.
