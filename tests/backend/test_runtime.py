"""Unit tests for pure runtime helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import importlib.util
from pathlib import Path
import sys
import unittest


def _load_runtime_module():
    root = Path(__file__).resolve().parents[2]
    module_path = root / "custom_components" / "grafana_image" / "runtime.py"
    spec = importlib.util.spec_from_file_location("grafana_image_runtime", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


runtime = _load_runtime_module()


class NormalizeIntegrationConfigTests(unittest.TestCase):
    def test_applies_defaults(self):
        config = runtime.normalize_integration_config({"url": "http://grafana.local:3000/"})

        self.assertEqual(config["url"], "http://grafana.local:3000")
        self.assertIsNone(config["api_token"])
        self.assertEqual(config["cache_seconds"], 60)
        self.assertEqual(config["timeout_seconds"], 20)


class ParseRenderRequestTests(unittest.TestCase):
    def test_applies_defaults(self):
        params = runtime.parse_render_request(
            {
                "dashboard_uid": "aquarium",
                "panel_id": "4",
                "from": "now-24h",
                "to": "now",
            }
        )

        self.assertEqual(params["slug"], "_")
        self.assertEqual(params["org_id"], 1)
        self.assertEqual(params["theme"], "dark")
        self.assertEqual(params["width"], 900)
        self.assertEqual(params["height"], 320)

    def test_rejects_missing_required_params(self):
        with self.assertRaises(runtime.QueryValidationError):
            runtime.parse_render_request(
                {
                    "dashboard_uid": "aquarium",
                    "panel_id": "4",
                    "from": "now-24h",
                }
            )

    def test_rejects_invalid_numeric_params(self):
        with self.assertRaises(runtime.QueryValidationError):
            runtime.parse_render_request(
                {
                    "dashboard_uid": "aquarium",
                    "panel_id": "abc",
                    "from": "now-24h",
                    "to": "now",
                }
            )

        with self.assertRaises(runtime.QueryValidationError):
            runtime.parse_render_request(
                {
                    "dashboard_uid": "aquarium",
                    "panel_id": "4",
                    "from": "now-24h",
                    "to": "now",
                    "width": "0",
                }
            )


class UrlAndCacheTests(unittest.TestCase):
    def test_builds_render_url(self):
        params = {
            "dashboard_uid": "aquarium",
            "panel_id": 4,
            "from": "now-24h",
            "to": "now",
            "slug": "_",
            "org_id": 1,
            "theme": "dark",
            "width": 900,
            "height": 320,
        }

        url = runtime.build_grafana_render_url("http://grafana.local:3000", params)

        self.assertIn("/render/d-solo/aquarium/_", url)
        self.assertIn("panelId=4", url)
        self.assertIn("orgId=1", url)
        self.assertIn("width=900", url)
        self.assertIn("height=320", url)

    def test_builds_stable_cache_key(self):
        params = {
            "dashboard_uid": "aquarium",
            "slug": "_",
            "panel_id": 4,
            "org_id": 1,
            "from": "now-24h",
            "to": "now",
            "theme": "dark",
            "width": 900,
            "height": 320,
        }

        cache_key = runtime.build_cache_key(params)

        self.assertEqual(
            cache_key,
            ("aquarium", "_", 4, 1, "now-24h", "now", "dark", 900, 320),
        )

    def test_cache_entry_validity(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        valid_entry = runtime.build_cache_entry(b"png", "image/png", 60, now=now)

        self.assertTrue(runtime.cache_entry_is_valid(valid_entry, now=now + timedelta(seconds=30)))
        self.assertFalse(
            runtime.cache_entry_is_valid(valid_entry, now=now + timedelta(seconds=61))
        )


if __name__ == "__main__":
    unittest.main()
