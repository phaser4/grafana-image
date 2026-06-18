const assert = require("node:assert/strict");

const {
  buildImageUrl,
  computeRefreshBucket,
  getAuthorizationHeader,
  normalizeConfig,
  resolveRenderDimensions,
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
  assert.equal(config.height, 320);
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
      height: 480,
      refresh_seconds: 30,
    },
    60000,
    512,
  );

  assert.match(url, /^\/api\/grafana_image\/render\?/);
  assert.match(url, /dashboard_uid=aquarium/);
  assert.match(url, /panel_id=4/);
  assert.match(url, /from=now-24h/);
  assert.match(url, /to=now/);
  assert.match(url, /width=512/);
  assert.match(url, /height=480/);
  assert.match(url, /t=2/);
});

run("resolveRenderDimensions uses card width and configured height", () => {
  const dimensions = resolveRenderDimensions(
    {
      dashboard_uid: "aquarium",
      panel_id: 4,
      from: "now-24h",
      to: "now",
      width: 900,
      height: 320,
    },
    600,
  );

  assert.equal(dimensions.width, 600);
  assert.equal(dimensions.height, 320);
});

run("resolveRenderDimensions uses fallback width before measurement", () => {
  const dimensions = resolveRenderDimensions(
    {
      dashboard_uid: "aquarium",
      panel_id: 4,
      from: "now-24h",
      to: "now",
      width: 900,
      height: 320,
    },
    undefined,
  );

  assert.equal(dimensions.width, 900);
  assert.equal(dimensions.height, 320);
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
