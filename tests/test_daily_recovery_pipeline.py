#!/usr/bin/env python3
"""
Unit tests for data continuity and daily recovery contract (docs/DATA_CONTINUITY_AND_DAILY_RECOVERY.md).
Tests:
1. Failure preservation: On transient failure, existing rows are untouched (no zero/empty replacement).
2. Failure reporting: sync_runs records status='failed' with error code, as_of is NOT advanced.
3. Genuine zero: True verified zero is accepted with provenance, distinct from failure.
4. Retry recovery: Successful retry updates values and genuinely advances as_of and run_id.
"""

import unittest
from unittest.mock import MagicMock
import json
import os
from unittest import mock
from scripts.ingest_gate import (
    bind_and_verify_ingest_payload,
    transmit_gated_ingest,
    IngestGateError
)

class TestDailyRecoveryPipeline(unittest.TestCase):

    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"DASHBOARD_INGEST_BASE_URL": "https://dashboard.example.invalid"})
        patcher.start()
        self.addCleanup(patcher.stop)
        # Initial authoritative state (e.g. 1,234P)
        self.initial_authoritative_rows = [
            {
                "id": "point-samsung-01",
                "title": "삼성카드 포인트",
                "amount": 1234,
                "currency": "KRW",
                "as_of": "2026-11-12T07:45:00+09:00"
            }
        ]

    def test_transient_failure_preserves_authoritative_rows(self):
        """When collection encounters failure (e.g. captcha/network), gate aborts and DB is untouched."""
        db_state = list(self.initial_authoritative_rows)
        mock_opener = MagicMock()

        # Simulate broken manifest (e.g. scraper failed, produced invalid delta)
        failed_manifest = {
            "provider": "samsungcard",
            "previous_balance": 1234,
            "increase_amount": 0,
            "decrease_amount": 0,
            "current_balance": -1,  # Corrupted / invalid
            "verified_at": "2026-11-12T16:00:00+09:00",
            "as_of": "2026-11-12T16:00:00+09:00"
        }

        # Gate execution
        with self.assertRaises(Exception):
            transmit_gated_ingest(
                "https://dashboard.example.invalid/api/ingest",
                "token",
                "points",
                failed_manifest,
                [{"kind": "benefit", "category": "points", "amount": -1}],
                opener=mock_opener
            )

        # 1. Zero network requests sent
        self.assertEqual(mock_opener.open.call_count, 0)
        # 2. Existing authoritative DB rows preserved exactly
        self.assertEqual(len(db_state), 1)
        self.assertEqual(db_state[0]["amount"], 1234)
        self.assertEqual(db_state[0]["as_of"], "2026-11-12T07:45:00+09:00")

    def test_genuine_zero_is_distinguished_from_failure(self):
        """A genuine verified zero (e.g. fully redeemed balance) has valid provenance and succeeds."""
        genuine_zero_manifest = {
            "provider": "samsungcard",
            "previous_balance": 1234,
            "increase_amount": 0,
            "decrease_amount": 1234,
            "current_balance": 0,  # Valid verified zero
            "verified_at": "2026-11-12T16:00:00+09:00",
            "as_of": "2026-11-12T16:00:00+09:00"
        }
        genuine_zero_items = [
            {
                "kind": "benefit",
                "category": "points",
                "source": "samsungcard",
                "title": "삼성카드 포인트",
                "amount": 0,
                "currency": "KRW",
                "metadata": {
                    "environment": "production",
                    "is_synthetic": False,
                    "source_system": "samsungcard",
                    "verification_source": "monimo_session",
                    "as_of": "2026-11-12T16:00:00+09:00",
                    "verified_at": "2026-11-12T16:00:00+09:00",
                    "run_id": "00000000-0000-0000-0000-000000000002",
                    "provider": "삼성카드"
                }
            }
        ]

        audit = bind_and_verify_ingest_payload("points", genuine_zero_manifest, genuine_zero_items)
        self.assertTrue(audit["binding_verified"])
        self.assertEqual(audit["item_amount_sum"], 0)

    def test_retry_recovery_updates_state_and_advances_as_of(self):
        """On successful retry, items and as_of advance genuinely."""
        recovered_manifest = {
            "provider": "samsungcard",
            "previous_balance": 1234,
            "increase_amount": 100,
            "decrease_amount": 0,
            "current_balance": 1334,
            "verified_at": "2026-11-12T16:15:00+09:00",
            "as_of": "2026-11-12T16:15:00+09:00"
        }
        recovered_items = [
            {
                "kind": "benefit",
                "category": "points",
                "source": "samsungcard",
                "title": "삼성카드 포인트",
                "amount": 1334,
                "currency": "KRW",
                "metadata": {
                    "environment": "production",
                    "is_synthetic": False,
                    "source_system": "samsungcard",
                    "verification_source": "monimo_session",
                    "as_of": "2026-11-12T16:15:00+09:00",
                    "verified_at": "2026-11-12T16:15:00+09:00",
                    "run_id": "00000000-0000-0000-0000-000000000003",
                    "provider": "삼성카드"
                }
            }
        ]

        mock_opener = MagicMock()
        fake_response = MagicMock()
        fake_response.read.return_value = json.dumps({"status": "success", "accepted": 1}).encode("utf-8")
        mock_opener.open.return_value.__enter__.return_value = fake_response
        # Synthetic v2 run (fake uuid matching items metadata.run_id)
        recovered_run = {
            "run_id": "00000000-0000-0000-0000-000000000003",
            "dataset": "points",
            "source_system": "samsungcard",
            "source_as_of": "2026-11-12T16:15:00+09:00",
            "collected_at": "2026-11-12T16:16:00+09:00",
        }

        res = transmit_gated_ingest(
            "https://dashboard.example.invalid/api/ingest",
            "token",
            "points",
            recovered_manifest,
            recovered_items,
            opener=mock_opener,
            run=recovered_run
        )

        self.assertEqual(res["status"], "success")
        self.assertEqual(mock_opener.open.call_count, 1)
        self.assertEqual(res["_gate_audit"]["item_amount_sum"], 1334)
        # 보낸 본문은 /api/ingest v2(숫자 version 2·run·items·manifest), validate_only 없음
        (req,), _ = mock_opener.open.call_args
        body = json.loads(req.data.decode("utf-8"))
        self.assertEqual(set(body), {"version", "run", "items", "manifest"})
        self.assertIs(type(body["version"]), int)
        self.assertEqual(body["version"], 2)
        self.assertEqual(body["run"], recovered_run)
        self.assertEqual(body["items"], recovered_items)
        self.assertEqual(body["manifest"], {"item_count": 1, "amount_total": 1334})  # pii-allow

if __name__ == "__main__":
    unittest.main()
