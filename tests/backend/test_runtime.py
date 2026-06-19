"""Unit tests for pure runtime helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import importlib.util
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
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
    def test_build_runtime_state_includes_cache_and_locks(self):
        state = runtime.build_runtime_state({"url": "http://grafana.local:3000/"})

        self.assertEqual(state["config"]["url"], "http://grafana.local:3000")
        self.assertEqual(state["cache"], {})
        self.assertEqual(state["render_states"], {})
        self.assertEqual(list(state["render_queue"]), [])
        self.assertEqual(state["queued_keys"], set())
        self.assertIsNone(state["render_event"])

    def test_applies_defaults(self):
        config = runtime.normalize_integration_config({"url": "http://grafana.local:3000/"})

        self.assertEqual(config["url"], "http://grafana.local:3000")
        self.assertIsNone(config["api_token"])
        self.assertEqual(config["cache_seconds"], 60)
        self.assertEqual(config["max_concurrent_renders"], 2)
        self.assertEqual(config["timeout_seconds"], 20)

    def test_applies_custom_concurrency_limit(self):
        config = runtime.normalize_integration_config(
            {
                "url": "http://grafana.local:3000/",
                "max_concurrent_renders": 4,
            }
        )

        self.assertEqual(config["max_concurrent_renders"], 4)


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
        self.assertEqual(params["refresh_seconds"], 600)

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
        valid_entry = runtime.build_cache_entry(
            b"png", "image/png", 60, 30, now=now
        )

        self.assertTrue(runtime.cache_entry_is_valid(valid_entry, now=now + timedelta(seconds=30)))
        self.assertTrue(
            runtime.cache_entry_is_valid(valid_entry, now=now + timedelta(days=365))
        )
        self.assertTrue(runtime.cache_entry_is_fresh(valid_entry, now=now + timedelta(seconds=29)))
        self.assertFalse(runtime.cache_entry_is_fresh(valid_entry, now=now + timedelta(seconds=31)))

    def test_cache_record_round_trip(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        cache_key = ("aquarium", "_", 4, 1, "now-24h", "now", "dark", 900, 320)
        entry = runtime.build_cache_entry(b"png-bytes", "image/png", 60, 30, now=now)

        payload = runtime.serialize_cache_entry(cache_key, entry)
        restored_key, restored_entry = runtime.deserialize_cache_entry(payload)

        self.assertEqual(restored_key, cache_key)
        self.assertEqual(restored_entry.content, b"png-bytes")
        self.assertEqual(restored_entry.content_type, "image/png")
        self.assertEqual(restored_entry.rendered_at, now)
        self.assertEqual(restored_entry.refresh_seconds, 30)
        self.assertEqual(restored_entry.fresh_until, now + timedelta(seconds=30))
        self.assertIsNone(restored_entry.expires_at)

    def test_persist_and_load_cache_entries(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        cache_key = ("aquarium", "_", 4, 1, "now-24h", "now", "dark", 900, 320)
        entry = runtime.build_cache_entry(b"png-bytes", "image/png", 60, 30, now=now)

        with TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            runtime.persist_cache_entry(cache_dir, cache_key, entry)
            loaded = runtime.load_cache_entries(cache_dir)

        self.assertIn(cache_key, loaded)
        self.assertEqual(loaded[cache_key].content, b"png-bytes")
        self.assertEqual(loaded[cache_key].rendered_at, now)
        self.assertEqual(loaded[cache_key].refresh_seconds, 30)

    def test_build_render_params_from_cache_key(self):
        params = runtime.build_render_params_from_cache_key(
            ("aquarium", "_", 4, 1, "now-24h", "now", "dark", 900, 320),
            600,
        )

        self.assertEqual(
            params,
            {
                "dashboard_uid": "aquarium",
                "slug": "_",
                "panel_id": 4,
                "org_id": 1,
                "from": "now-24h",
                "to": "now",
                "theme": "dark",
                "width": 900,
                "height": 320,
                "refresh_seconds": 600,
            },
        )

    def test_deserialize_v1_cache_record_infers_refresh_seconds(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        cache_key = ("aquarium", "_", 4, 1, "now-24h", "now", "dark", 900, 320)
        payload = {
            "version": 1,
            "cache_key": list(cache_key),
            "expires_at": None,
            "fresh_until": (now + timedelta(seconds=45)).isoformat(),
            "rendered_at": now.isoformat(),
            "content_type": "image/png",
            "content_b64": "YmluYXJ5",
        }

        restored_key, restored_entry = runtime.deserialize_cache_entry(payload)

        self.assertEqual(restored_key, cache_key)
        self.assertEqual(restored_entry.content, b"binary")
        self.assertEqual(restored_entry.refresh_seconds, 45)


class StatusResolutionTests(unittest.TestCase):
    def test_reports_error_before_queued_when_last_render_failed(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        state = runtime.RenderState(
            is_queued=True,
            last_error="Grafana render request failed: 404",
        )

        status = runtime.resolve_render_status(None, state, now)

        self.assertEqual(status, "error")
        self.assertEqual(
            runtime.build_status_message(status, state),
            "Grafana render request failed: 404",
        )

    def test_reports_queued_without_error_when_render_has_not_run_yet(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        state = runtime.RenderState(is_queued=True)

        status = runtime.resolve_render_status(None, state, now)

        self.assertEqual(status, "queued")
        self.assertEqual(runtime.build_status_message(status, state), "Image render queued")


if __name__ == "__main__":
    unittest.main()
