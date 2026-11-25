#!/usr/bin/env python3
"""
Unit tests for ingest_gate.py
Tests:
- HTTPS endpoint allowlist enforcement.
- Strict rejection of HTTP redirects.
- Invariant verification and cryptographic binding between manifest and items.
- Mock network isolation: exactly 0 network calls when invariants or bindings fail.
- All fixtures are 100% synthetic (zero real PII).
"""

import unittest
from unittest.mock import MagicMock
import io
import json
import os
import urllib.request
from unittest import mock
from scripts.ingest_gate import (
    validate_endpoint_url,
    bind_and_verify_ingest_payload,
    transmit_gated_ingest,
    get_ingest_origin,
    NoRedirectHandler,
    ALLOWED_INGEST_PATHS,
    IngestGateError,
    InvariantError
)

ORIGIN = "https://dashboard.example.invalid"

# Synthetic v2 run (fake uuid, zero real data)
SYNTHETIC_RUN = {
    "run_id": "00000000-0000-4000-8000-000000000001",
    "dataset": "points",
    "source_system": "samsungcard",
    "source_as_of": "2026-11-12T10:00:00+09:00",
    "collected_at": "2026-11-12T10:05:00+09:00",
}

def sent_body(opener):
    """JSON body of the single request handed to the mock opener."""
    (req,), _ = opener.open.call_args
    return json.loads(req.data.decode("utf-8"))

class TestIngestGate(unittest.TestCase):

    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"DASHBOARD_INGEST_BASE_URL": ORIGIN})
        patcher.start()
        self.addCleanup(patcher.stop)
        # Synthetic points manifest & item (zero real PII)
        self.synthetic_points_manifest = {
            "provider": "samsungcard",
            "previous_balance": 10000,
            "increase_amount": 500,
            "decrease_amount": 200,
            "current_balance": 10300,
            "verified_at": "2026-11-12T10:00:00+09:00",
            "as_of": "2026-11-12T10:00:00+09:00"
        }
        self.synthetic_points_items = [
            {
                "kind": "benefit",
                "category": "points",
                "source": "samsungcard",
                "title": "삼성카드 포인트",
                "amount": 10300,
                "currency": "KRW",
                "metadata": {
                    "environment": "production",
                    "is_synthetic": False,
                    "source_system": "samsungcard",
                    "verification_source": "monimo_session",
                    "as_of": "2026-11-12T10:00:00+09:00",
                    "verified_at": "2026-11-12T10:00:00+09:00",
                    "run_id": "00000000-0000-0000-0000-000000000001",
                    "provider": "삼성카드"
                }
            }
        ]

    # --- Endpoint Allowlist Tests ---

    def test_allowlist_permits_official_endpoints(self):
        for p in ALLOWED_INGEST_PATHS:
            validate_endpoint_url(ORIGIN + p)  # Should not raise

    def test_allowlist_is_exactly_ingest(self):
        self.assertEqual(ALLOWED_INGEST_PATHS, ("/api/ingest",))
        validate_endpoint_url(ORIGIN + "/api/ingest")

    def test_removed_sync_runs_rejected_without_network(self):
        with self.assertRaises(IngestGateError) as ctx:
            validate_endpoint_url(ORIGIN + "/api/sync-runs")
        self.assertEqual(str(ctx.exception), "UNAUTHORIZED_ENDPOINT")
        mock_opener = MagicMock()
        with self.assertRaises(IngestGateError) as ctx:
            transmit_gated_ingest(ORIGIN + "/api/sync-runs", "test-token", "points",
                                  self.synthetic_points_manifest, self.synthetic_points_items,
                                  opener=mock_opener, run=dict(SYNTHETIC_RUN))
        self.assertEqual(str(ctx.exception), "UNAUTHORIZED_ENDPOINT")
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_removed_backfill_preview_rejected_without_network(self):
        with self.assertRaises(IngestGateError) as ctx:
            validate_endpoint_url(ORIGIN + "/api/backfill/preview")
        self.assertEqual(str(ctx.exception), "UNAUTHORIZED_ENDPOINT")
        mock_opener = MagicMock()
        with self.assertRaises(IngestGateError) as ctx:
            transmit_gated_ingest(
                ORIGIN + "/api/backfill/preview",
                "test-token",
                "points",
                self.synthetic_points_manifest,
                self.synthetic_points_items,
                opener=mock_opener
            )
        self.assertEqual(str(ctx.exception), "UNAUTHORIZED_ENDPOINT")
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_allowlist_rejects_foreign_host(self):
        with self.assertRaises(IngestGateError) as ctx:
            validate_endpoint_url("https://malicious-site.com/api/ingest")
        self.assertIn("UNAUTHORIZED_ENDPOINT", str(ctx.exception))

    def test_allowlist_rejects_plain_http(self):
        with self.assertRaises(IngestGateError) as ctx:
            validate_endpoint_url("http://dashboard.example.invalid/api/ingest")
        self.assertIn("UNAUTHORIZED_ENDPOINT", str(ctx.exception))

    # --- Binding Tests ---

    def test_binding_success_on_valid_payload(self):
        audit = bind_and_verify_ingest_payload(
            "points",
            self.synthetic_points_manifest,
            self.synthetic_points_items
        )
        self.assertTrue(audit["binding_verified"])
        self.assertEqual(audit["item_count"], 1)
        self.assertEqual(audit["item_amount_sum"], 10300)
        self.assertTrue(len(audit["payload_digest"]) == 64)

    def test_binding_rejects_amount_mismatch(self):
        # Tamper item amount
        tampered_items = [{**self.synthetic_points_items[0], "amount": 10000}]
        with self.assertRaises(IngestGateError) as ctx:
            bind_and_verify_ingest_payload(
                "points",
                self.synthetic_points_manifest,
                tampered_items
            )
        self.assertIn("POINTS_AMOUNT_BINDING_MISMATCH", str(ctx.exception))

    def test_binding_rejects_count_mismatch(self):
        # Add unexpected second item
        tampered_items = self.synthetic_points_items + self.synthetic_points_items
        with self.assertRaises(IngestGateError) as ctx:
            bind_and_verify_ingest_payload(
                "points",
                self.synthetic_points_manifest,
                tampered_items
            )
        self.assertIn("ITEM_COUNT_BINDING_MISMATCH", str(ctx.exception))

    # --- Mock Network Isolation Tests (Zero Calls on Failure) ---

    def test_mock_network_call_is_zero_on_endpoint_failure(self):
        mock_opener = MagicMock()
        with self.assertRaises(IngestGateError):
            transmit_gated_ingest(
                "https://unauthorized.domain/api/ingest",
                "test-token",
                "points",
                self.synthetic_points_manifest,
                self.synthetic_points_items,
                opener=mock_opener
            )
        # Network call MUST NOT occur
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_mock_network_call_is_zero_on_manifest_invariant_failure(self):
        mock_opener = MagicMock()
        # Invalidate manifest (broken delta invariant)
        broken_manifest = {**self.synthetic_points_manifest, "current_balance": 99999}
        with self.assertRaises(InvariantError):
            transmit_gated_ingest(
                "https://dashboard.example.invalid/api/ingest",
                "test-token",
                "points",
                broken_manifest,
                self.synthetic_points_items,
                opener=mock_opener
            )
        # Network call MUST NOT occur
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_mock_network_call_is_zero_on_item_binding_failure(self):
        mock_opener = MagicMock()
        tampered_items = [{**self.synthetic_points_items[0], "amount": 99999}]
        with self.assertRaises(IngestGateError):
            transmit_gated_ingest(
                "https://dashboard.example.invalid/api/ingest",
                "test-token",
                "points",
                self.synthetic_points_manifest,
                tampered_items,
                opener=mock_opener
            )
        # Network call MUST NOT occur
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_mock_network_executes_when_all_invariants_hold(self):
        mock_opener = MagicMock()
        fake_response = MagicMock()
        fake_response.read.return_value = json.dumps({"status": "success", "accepted": 1}).encode("utf-8")
        mock_opener.open.return_value.__enter__.return_value = fake_response

        res = transmit_gated_ingest(
            "https://dashboard.example.invalid/api/ingest",
            "valid-bearer-token",
            "points",
            self.synthetic_points_manifest,
            self.synthetic_points_items,
            validate_only=False,
            opener=mock_opener,
            run=dict(SYNTHETIC_RUN)
        )

        self.assertEqual(mock_opener.open.call_count, 1)
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["_gate_audit"]["binding_verified"])
        body = sent_body(mock_opener)
        self.assertEqual(set(body), {"version", "run", "items", "manifest"})
        self.assertNotIn("validate_only", body)
        self.assertIs(type(body["version"]), int)
        self.assertEqual(body["version"], 2)
        self.assertEqual(body["run"], SYNTHETIC_RUN)
        self.assertEqual(body["items"], self.synthetic_points_items)
        self.assertEqual(body["manifest"], {"item_count": 1, "amount_total": 10300})  # pii-allow
        (req,), _ = mock_opener.open.call_args
        self.assertEqual(req.full_url, ORIGIN + "/api/ingest")
        self.assertEqual(req.get_header("X-payload-digest"), res["_gate_audit"]["payload_digest"])
        self.assertEqual(req.get_header("X-request-body-sha256"), res["_gate_audit"]["request_body_sha256"])

    def test_validate_only_true_sends_nothing(self):
        mock_opener = MagicMock()
        res = transmit_gated_ingest(
            ORIGIN + "/api/ingest", "valid-bearer-token", "points",
            self.synthetic_points_manifest, self.synthetic_points_items,
            validate_only=True, opener=mock_opener, run=dict(SYNTHETIC_RUN))
        self.assertEqual(mock_opener.open.call_count, 0)
        self.assertIs(res["sent"], False)
        self.assertEqual(res["validated"], 1)
        self.assertEqual(res["upserted"], 0)
        self.assertTrue(res["_gate_audit"]["binding_verified"])
        # run 이 없어도 검증 전용은 네트워크 없이 로컬 결과만
        res2 = transmit_gated_ingest(
            ORIGIN + "/api/ingest", "valid-bearer-token", "points",
            self.synthetic_points_manifest, self.synthetic_points_items,
            validate_only=True, opener=mock_opener)
        self.assertIs(res2["sent"], False)
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_validate_only_true_still_checks_binding_first(self):
        mock_opener = MagicMock()
        tampered_items = [{**self.synthetic_points_items[0], "amount": 99999}]
        with self.assertRaises(IngestGateError):
            transmit_gated_ingest(ORIGIN + "/api/ingest", "tok", "points",
                                  self.synthetic_points_manifest, tampered_items,
                                  validate_only=True, opener=mock_opener)
        self.assertEqual(mock_opener.open.call_count, 0)

    def test_write_without_run_is_rejected_without_network(self):
        cases = [None, "not-a-dict", {}]
        for key in ("run_id", "dataset", "source_system", "source_as_of", "collected_at"):
            cases.append({k: v for k, v in SYNTHETIC_RUN.items() if k != key})
        for run in cases:
            with self.subTest(run=run):
                mock_opener = MagicMock()
                with self.assertRaises(IngestGateError) as ctx:
                    transmit_gated_ingest(ORIGIN + "/api/ingest", "tok", "points",
                                          self.synthetic_points_manifest, self.synthetic_points_items,
                                          validate_only=False, opener=mock_opener, run=run)
                self.assertEqual(str(ctx.exception), "RUN_REQUIRED")
                self.assertEqual(mock_opener.open.call_count, 0)

    def test_statement_requires_explicit_count_and_principal_binding(self):
        manifest = {"account_key":"opaque-a","billing_month":"2026-11","domestic_lump_sum_krw":100,"overseas_lump_sum_krw":0,"installment_principal_krw":0,"fee_krw":5,"point_deduction_krw":0,"total_billed_krw":105,"net_due_krw":105}
        item = {"kind":"transaction","currency":"KRW","amount":100,"metadata":{"source_system":"samsungcard","account_key":"opaque-a","billing_month":"2026-11","amount_basis":"statement_billed"}}
        with self.assertRaises(IngestGateError):
            bind_and_verify_ingest_payload("statement",manifest,[item])
        manifest.update(expected_item_count=1,item_amount_basis="statement_principal")
        self.assertTrue(bind_and_verify_ingest_payload("statement",manifest,[item])["binding_verified"])
        with self.assertRaises(IngestGateError):
            bind_and_verify_ingest_payload("statement",manifest,[{**item,"amount":105}])

    def test_points_wrong_provider_blocked(self):
        item = {**self.synthetic_points_items[0], "metadata":{**self.synthetic_points_items[0]["metadata"],"provider":"네이버페이"}}
        with self.assertRaises(IngestGateError):
            bind_and_verify_ingest_payload("points",self.synthetic_points_manifest,[item])

    def test_ingest_body_cannot_be_sent_to_sync_endpoint(self):
        mock_opener = MagicMock()
        with self.assertRaises(IngestGateError):
            transmit_gated_ingest("https://dashboard.example.invalid/api/sync-runs","token","points",self.synthetic_points_manifest,self.synthetic_points_items,opener=mock_opener,run=dict(SYNTHETIC_RUN))
        self.assertEqual(mock_opener.open.call_count,0)

class TestIngestBaseUrlEnv(unittest.TestCase):
    URL = ORIGIN + "/api/ingest"

    def _data(self):
        t = TestIngestGate("test_binding_success_on_valid_payload")
        t.setUp()
        self.addCleanup(t.doCleanups)
        return t.synthetic_points_manifest, t.synthetic_points_items

    def _assert_rejected(self, value):
        manifest, items = self._data()
        opener = MagicMock()
        env = dict(os.environ)
        env.pop("DASHBOARD_INGEST_BASE_URL", None)
        if value is not None:
            env["DASHBOARD_INGEST_BASE_URL"] = value
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(IngestGateError) as ctx:
                transmit_gated_ingest(self.URL, "tok", "points", manifest, items, opener=opener)
        self.assertEqual(opener.open.call_count, 0)
        msg = str(ctx.exception)
        self.assertNotIn("example.invalid", msg)
        self.assertNotIn("http", msg)

    def test_missing_env_rejected(self):
        self._assert_rejected(None)

    def test_invalid_values_rejected_without_network(self):
        bad = ["", "   ", "http://dashboard.example.invalid",
               "https://dashboard.example.invalid/api/ingest",
               "https://dashboard.example.invalid//",
               "https://user:pw@dashboard.example.invalid",
               "https://dashboard.example.invalid:", "https://dashboard.example.invalid:abc",
               "https://dashboard.example.invalid:0", "https://dashboard.example.invalid:65536",
               "https://dashboard.example.invalid?", "https://dashboard.example.invalid/?",
               "https://dashboard.example.invalid#", "https://dashboard.example.invalid/#",
               "https://", "https:///x"]
        for value in bad:
            with self.subTest(value=value):
                self._assert_rejected(value)

    def test_origin_error_is_code_only(self):
        with mock.patch.dict(os.environ, {"DASHBOARD_INGEST_BASE_URL": "http://secret-host.example.invalid"}):
            with self.assertRaises(IngestGateError) as ctx:
                get_ingest_origin()
        self.assertEqual(str(ctx.exception), "INGEST_BASE_URL_INVALID")

    def test_whitespace_trimmed_slash_and_port_ok(self):
        with mock.patch.dict(os.environ, {"DASHBOARD_INGEST_BASE_URL": "  https://dashboard.example.invalid:8443/ "}):
            self.assertEqual(get_ingest_origin(), "https://dashboard.example.invalid:8443")

    def test_other_host_rejected_and_configured_origin_allowed(self):
        manifest, items = self._data()
        opener = MagicMock()
        with self.assertRaises(IngestGateError) as ctx:
            transmit_gated_ingest("https://other.example.invalid/api/ingest", "tok", "points", manifest, items, opener=opener)
        self.assertEqual(str(ctx.exception), "UNAUTHORIZED_ENDPOINT")
        self.assertEqual(opener.open.call_count, 0)
        resp = MagicMock()
        resp.read.return_value = b'{"status":"ok"}'
        opener.open.return_value.__enter__.return_value = resp
        with mock.patch.dict(os.environ, {"DASHBOARD_INGEST_BASE_URL": ORIGIN}):
            res = transmit_gated_ingest(self.URL, "tok", "points", manifest, items, opener=opener, run=dict(SYNTHETIC_RUN))
        self.assertEqual(res["status"], "ok")
        self.assertEqual(opener.open.call_count, 1)

    def test_redirect_blocked_without_target_in_error(self):
        req = urllib.request.Request(self.URL)
        with self.assertRaises(IngestGateError) as ctx:
            NoRedirectHandler().redirect_request(req, None, 302, "Found", {}, "https://redirect-target.example.invalid/x")
        self.assertEqual(str(ctx.exception), "HTTP_REDIRECT_FORBIDDEN")

    def test_redirect_response_causes_no_followup_send(self):
        manifest, items = self._data()
        opener = MagicMock()
        opener.open.side_effect = IngestGateError("HTTP_REDIRECT_FORBIDDEN")
        with mock.patch.dict(os.environ, {"DASHBOARD_INGEST_BASE_URL": ORIGIN}):
            with self.assertRaises(IngestGateError) as ctx:
                transmit_gated_ingest(self.URL, "tok", "points", manifest, items, opener=opener, run=dict(SYNTHETIC_RUN))
        self.assertEqual(opener.open.call_count, 1)
        self.assertNotIn("example.invalid", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
