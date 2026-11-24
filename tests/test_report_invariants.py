#!/usr/bin/env python3
"""
Unit test suite for verify_report_invariants.py
Tests fail-closed checks, missing fields, type errors, malformed hashes,
and all 4 financial domains.
"""

import unittest
import copy
from scripts.verify_report_invariants import (
    verify_backfill_preview_invariants,
    verify_points_ledger_invariants,
    verify_statement_billing_invariants,
    verify_settlement_tracker_invariants,
    render_preview_report_markdown,
    verify_report_text_parity,
    InvariantError
)

class TestReportInvariants(unittest.TestCase):

    def setUp(self):
        # Valid preview fixture
        self.valid_preview = {
            "status": "preview_only",
            "inventory_count": 20,
            "inventory_amount_krw": 1000000,
            "classification_counts": {
                "exact_unique": 15,
                "ambiguous": 2,
                "unmatched": 3,
                "conflict": 0
            },
            "classification_amounts_krw": {
                "exact_unique": 700000,
                "ambiguous": 100000,
                "unmatched": 200000,
                "conflict": 0
            },
            "eligible_count": 15,
            "eligible_amount_krw": 700000,
            "unresolved_count": 5,
            "unresolved_amount_krw": 300000,
            "problems": [],
            "inventory_digest": "f592af2c2c2dae0ecf20f5c7c44cce05247913b955c6279e959e6cf79c70bb6f",
            "plan_digest": "42fa695eb607508e7875c327874c84b2952b9745e712191668111835d20099ed",
            "applied_count": 0
        }

        # Valid points fixture
        self.valid_points = {
            "provider": "samsungcard",
            "previous_balance": 5000,
            "increase_amount": 0,
            "decrease_amount": 3766,
            "current_balance": 1234,
            "verified_at": "2026-11-12T07:45:00+09:00",
            "as_of": "2026-11-12T07:45:00+09:00"
        }

        # Valid statement billing fixture
        self.valid_statement = {
            "account_key": "card-alias-a",
            "billing_month": "2026-11",
            "domestic_lump_sum_krw": 500000,
            "overseas_lump_sum_krw": 20000,
            "installment_principal_krw": 100000,
            "fee_krw": 1000,
            "point_deduction_krw": 3766,
            "total_billed_krw": 621000,
            "net_due_krw": 617234
        }

        # Valid settlement fixture
        self.valid_settlement = {
            "trip_name": "여행 정산 A",
            "settlement_items": [
                {"target": "친구A", "amount_krw": 30000, "status": "unpaid"},
                {"target": "친구B (엔빵)", "amount_krw": 30000, "status": "unpaid"},
                {"target": "친구B (마켓)", "amount_krw": 20000, "status": "unpaid"}
            ],
            "total_amount_krw": 80000,
            "collected_amount_krw": 0,
            "pending_amount_krw": 80000
        }

    # --- Domain 1 Tests: Preview Fail-Closed & Checks ---

    def test_preview_valid_passes(self):
        logs = verify_backfill_preview_invariants(self.valid_preview)
        self.assertTrue(len(logs) >= 5)

    def test_preview_empty_payload_fails(self):
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants({})
        self.assertIn("MISSING_REQUIRED_FIELD", str(ctx.exception))

    def test_preview_missing_digest_fails(self):
        p = copy.deepcopy(self.valid_preview)
        del p["plan_digest"]
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants(p)
        self.assertIn("MISSING_REQUIRED_FIELD", str(ctx.exception))

    def test_preview_malformed_digest_fails(self):
        p = copy.deepcopy(self.valid_preview)
        p["plan_digest"] = "short_hash_123"
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants(p)
        self.assertIn("MALFORMED_SHA256", str(ctx.exception))

    def test_preview_type_mismatch_fails(self):
        p = copy.deepcopy(self.valid_preview)
        p["inventory_count"] = "20"  # string instead of int
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants(p)
        self.assertIn("TYPE_MISMATCH", str(ctx.exception))

    def test_preview_boolean_rejected_as_int(self):
        p = copy.deepcopy(self.valid_preview)
        p["applied_count"] = False  # bool must be rejected
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants(p)
        self.assertIn("TYPE_MISMATCH", str(ctx.exception))

    def test_preview_applied_mutation_fails(self):
        p = copy.deepcopy(self.valid_preview)
        p["applied_count"] = 1
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants(p)
        self.assertIn("MUTATION_DETECTED", str(ctx.exception))

    def test_preview_arithmetic_fudging_fails(self):
        p = copy.deepcopy(self.valid_preview)
        p["inventory_amount_krw"] += 1000
        with self.assertRaises(InvariantError) as ctx:
            verify_backfill_preview_invariants(p)
        self.assertIn("AMOUNT_INVARIANT_VIOLATION", str(ctx.exception))

    # --- Domain 2 Tests: Points Ledger ---

    def test_points_valid_passes(self):
        logs = verify_points_ledger_invariants(self.valid_points)
        self.assertTrue(len(logs) >= 1)

    def test_points_delta_mismatch_fails(self):
        pt = copy.deepcopy(self.valid_points)
        pt["current_balance"] = 5000  # should be 1234
        with self.assertRaises(InvariantError) as ctx:
            verify_points_ledger_invariants(pt)
        self.assertIn("POINT_DELTA_INVARIANT_VIOLATION", str(ctx.exception))

    def test_points_unauthorized_provider_fails(self):
        pt = copy.deepcopy(self.valid_points)
        pt["provider"] = "toss"
        with self.assertRaises(InvariantError) as ctx:
            verify_points_ledger_invariants(pt)
        self.assertIn("UNAUTHORIZED_POINT_PROVIDER", str(ctx.exception))

    # --- Domain 3 Tests: Statement Billing ---

    def test_statement_valid_passes(self):
        logs = verify_statement_billing_invariants(self.valid_statement)
        self.assertTrue(len(logs) >= 2)

    def test_statement_fee_fudging_fails(self):
        st = copy.deepcopy(self.valid_statement)
        st["fee_krw"] = 1919  # fudged fee
        with self.assertRaises(InvariantError) as ctx:
            verify_statement_billing_invariants(st)
        self.assertIn("STATEMENT_TOTAL_INVARIANT_VIOLATION", str(ctx.exception))

    def test_statement_net_due_mismatch_fails(self):
        st = copy.deepcopy(self.valid_statement)
        st["net_due_krw"] += 100
        with self.assertRaises(InvariantError) as ctx:
            verify_statement_billing_invariants(st)
        self.assertIn("STATEMENT_NET_DUE_INVARIANT_VIOLATION", str(ctx.exception))

    # --- Domain 4 Tests: Settlement Tracker ---

    def test_settlement_valid_passes(self):
        logs = verify_settlement_tracker_invariants(self.valid_settlement)
        self.assertTrue(len(logs) >= 1)

    def test_settlement_sum_mismatch_fails(self):
        st = copy.deepcopy(self.valid_settlement)
        st["total_amount_krw"] = 300000  # does not match item sum
        with self.assertRaises(InvariantError) as ctx:
            verify_settlement_tracker_invariants(st)
        self.assertIn("SETTLEMENT_ITEM_SUM_VIOLATION", str(ctx.exception))

    # --- Report Parity Tests ---

    def test_report_parity_passes(self):
        text = render_preview_report_markdown(self.valid_preview)
        self.assertTrue(verify_report_text_parity(text, self.valid_preview))

    def test_report_parity_catches_hallucinated_number(self):
        text = render_preview_report_markdown(self.valid_preview)
        tampered_text = text.replace("1000000원", "1001000원")
        with self.assertRaises(InvariantError) as ctx:
            verify_report_text_parity(tampered_text, self.valid_preview)
        self.assertIn("REPORT_PARITY_VIOLATION", str(ctx.exception))

    def test_report_parity_rejects_swap_of_existing_numbers(self):
        text = render_preview_report_markdown(self.valid_preview)
        tampered = text.replace("1000000원", "700000원")
        with self.assertRaises(InvariantError):
            verify_report_text_parity(tampered, self.valid_preview)

    def test_report_parity_rejects_missing_line_and_sign_change(self):
        text = render_preview_report_markdown(self.valid_preview)
        for tampered in (text.replace("1000000원", "-1000000원"), "\n".join(text.splitlines()[1:])):
            with self.assertRaises(InvariantError):
                verify_report_text_parity(tampered, self.valid_preview)

if __name__ == "__main__":
    unittest.main()
