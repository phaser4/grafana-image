# Grafana Image

Grafana Image is a Home Assistant custom integration plus Lovelace custom card for showing rendered Grafana panels as images inside a Home Assistant dashboard.

This repository currently contains the initial scaffold:

- HACS metadata
- Home Assistant custom component structure
- a placeholder backend API surface
- a placeholder frontend card resource

The full Grafana render proxy and image card behavior described in the project spec have not been implemented yet.

## Planned Design

The intended request flow is:

```text
Lovelace custom card
    ->
Home Assistant authenticated API endpoint
    ->
Grafana render API
    ->
PNG image returned to card
```

The browser must not call Grafana directly and must not receive the Grafana API token.

## Current State

Implemented today:

- repository structure for HACS and Home Assistant
- `grafana_image` integration domain
- YAML config schema for the planned backend settings
- placeholder `/api/grafana_image/render` endpoint
- static frontend endpoint for `grafana-image-card.js`
- placeholder Lovelace custom card

Not implemented yet:

- Grafana render proxying
- PNG response handling
- backend caching
- real card refresh behavior
- frontend image rendering

## Planned Configuration

Example future `configuration.yaml`:

```yaml
grafana_image:
  url: "http://grafana.local:3000"
  api_token: !secret grafana_api_token
  cache_seconds: 60
  timeout_seconds: 20
```

## Planned Lovelace Resource

```yaml
resources:
  - url: /api/grafana_image/static/grafana-image-card.js
    type: module
```

## Planned Card Example

```yaml
type: custom:grafana-image-card
dashboard_uid: aquarium
panel_id: 4
from: now-24h
to: now
title: Aquarium temperature
```

## Repository

- GitHub: [phaser4/grafana-image](https://github.com/phaser4/grafana-image)
