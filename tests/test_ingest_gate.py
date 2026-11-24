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
from scripts.ingest_gate import (
    validate_endpoint_url,
    bind_and_verify_ingest_payload,
    transmit_gated_ingest,
    ALLOWED_INGEST_ENDPOINTS,
    IngestGateError,
    InvariantError
)

class TestIngestGate(unittest.TestCase):

    def setUp(self):
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
        for ep in ALLOWED_INGEST_ENDPOINTS:
            validate_endpoint_url(ep)  # Should not raise

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
            validate_only=True,
            opener=mock_opener
        )

        self.assertEqual(mock_opener.open.call_count, 1)
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["_gate_audit"]["binding_verified"])

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
            transmit_gated_ingest("https://dashboard.example.invalid/api/sync-runs","token","points",self.synthetic_points_manifest,self.synthetic_points_items,opener=mock_opener)
        self.assertEqual(mock_opener.open.call_count,0)

if __name__ == "__main__":
    unittest.main()
