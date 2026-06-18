const assert = require("node:assert/strict");

const {
  buildImageUrl,
  computeCardSize,
  computeRefreshBucket,
  GRID_COLUMN_COUNT,
  MIN_FETCH_INTERVAL_MS,
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
} = require("../../custom_components/grafana_image/frontend/grafana-image-card.js");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("validateRequiredConfig rejects missing fields", () => {
  assert.throws(
    () => validateRequiredConfig({ dashboard_uid: "aquarium", panel_id: 4, from: "now-24h" }),
    /Missing required config field: to/,
  );
});

run("normalizeConfig applies defaults", () => {
  const config = normalizeConfig({
    dashboard_uid: "aquarium",
    panel_id: 4,
    from: "now-24h",
    to: "now",
  });

  assert.equal(config.slug, "_");
  assert.equal(config.org_id, 1);
  assert.equal(config.theme, "dark");
  assert.equal(config.width, 900);
  assert.equal(config.rows, 3);
  assert.equal(config.columns, 12);
  assert.equal(config.refresh_seconds, 60);
  assert.equal(config.fit, "contain");
});

run("computeRefreshBucket buckets by refresh interval", () => {
  assert.equal(computeRefreshBucket(60, 119999), 1);
  assert.equal(computeRefreshBucket(60, 120000), 2);
});

run("buildImageUrl encodes backend parameters", () => {
  const url = buildImageUrl(
    {
      dashboard_uid: "aquarium",
      panel_id: 4,
      from: "now-24h",
      to: "now",
      title: "Aquarium temperature",
      width: 1024,
      rows: 6,
      refresh_seconds: 30,
    },
    60000,
    512,
    284,
  );

  assert.match(url, /^\/api\/grafana_image\/render\?/);
  assert.match(url, /dashboard_uid=aquarium/);
  assert.match(url, /panel_id=4/);
  assert.match(url, /from=now-24h/);
  assert.match(url, /to=now/);
  assert.match(url, /width=512/);
  assert.match(url, /height=284/);
  assert.match(url, /t=2/);
});

run("shouldFetchImage allows first fetch", () => {
  assert.equal(shouldFetchImage("/api/grafana_image/render?t=1", undefined, 0, 5000), true);
});

run("shouldFetchImage blocks duplicate url inside min interval", () => {
  assert.equal(
    shouldFetchImage("/api/grafana_image/render?t=1", "/api/grafana_image/render?t=1", 1000, 1000 + MIN_FETCH_INTERVAL_MS - 1),
    false,
  );
});

run("shouldFetchImage allows duplicate url after min interval", () => {
  assert.equal(
    shouldFetchImage("/api/grafana_image/render?t=1", "/api/grafana_image/render?t=1", 1000, 1000 + MIN_FETCH_INTERVAL_MS),
    true,
  );
});

run("shouldFetchImage allows changed url immediately", () => {
  assert.equal(
    shouldFetchImage("/api/grafana_image/render?t=2", "/api/grafana_image/render?t=1", 1000, 1001),
    true,
  );
});

run("resolveRenderDimensions uses card width and configured height", () => {
  const dimensions = resolveRenderDimensions(
    {
      dashboard_uid: "aquarium",
      panel_id: 4,
      from: "now-24h",
      to: "now",
      width: 900,
      rows: 4,
    },
    600,
    180,
  );

  assert.equal(dimensions.width, 600);
  assert.equal(dimensions.height, 180);
});

run("resolveRenderDimensions uses fallback width and row-based height before measurement", () => {
  const dimensions = resolveRenderDimensions(
    {
      dashboard_uid: "aquarium",
      panel_id: 4,
      from: "now-24h",
      to: "now",
      width: 900,
      rows: 4,
    },
    undefined,
    undefined,
  );

  assert.equal(dimensions.width, 900);
  assert.equal(dimensions.height, 216);
});

run("computeCardSize uses configured rows", () => {
  assert.equal(computeCardSize({ rows: 3 }), 4);
  assert.equal(computeCardSize({ rows: 6 }), 8);
});

run("resolveCardRows clamps to at least one row", () => {
  assert.equal(resolveCardRows({ rows: 0 }), 1);
  assert.equal(resolveCardRows({ rows: 4.4 }), 4);
});

run("resolveCardColumns clamps to Home Assistant grid width", () => {
  assert.equal(resolveCardColumns({ columns: 0 }), 1);
  assert.equal(resolveCardColumns({ columns: 40 }), GRID_COLUMN_COUNT);
  assert.equal(resolveCardColumns({ columns: "full" }), "full");
});

run("resolveCardHeight uses official section row dimensions", () => {
  assert.equal(resolveCardHeight({ rows: 1 }), 56);
  assert.equal(resolveCardHeight({ rows: 3 }), 184);
});

run("resolveFallbackRenderHeight subtracts card chrome", () => {
  assert.equal(resolveFallbackRenderHeight({ rows: 3 }), 152);
  assert.equal(resolveFallbackRenderHeight({ rows: 3, title: "Aquarium" }), 112);
  assert.equal(resolveFallbackRenderHeight({ rows: 2 }), 88);
});

run("resolveGridOptions defaults to a full-width three-row card", () => {
  assert.deepEqual(resolveGridOptions({}), {
    rows: 3,
    columns: 12,
    min_rows: 3,
    max_rows: 3,
    min_columns: 12,
    max_columns: 12,
  });
});

run("getAuthorizationHeader reads Home Assistant token", () => {
  assert.equal(
    getAuthorizationHeader({ auth: { data: { accessToken: "abc123" } } }),
    "Bearer abc123",
  );
});

run("getAuthorizationHeader supports snake_case token", () => {
  assert.equal(
    getAuthorizationHeader({ auth: { data: { access_token: "snake123" } } }),
    "Bearer snake123",
  );
});

run("getAuthorizationHeader rejects missing token", () => {
  assert.throws(
    () => getAuthorizationHeader({}),
    /Home Assistant access token is not available/,
  );
});
