#!/usr/bin/env python3
"""
Unit test suite for verify_report_invariants.py
Tests fail-closed checks and all 3 financial domains
(points, statement, settlement).
"""

import unittest
import copy
from scripts.verify_report_invariants import (
    verify_points_ledger_invariants,
    verify_statement_billing_invariants,
    verify_settlement_tracker_invariants,
    InvariantError
)

class TestReportInvariants(unittest.TestCase):

    def setUp(self):
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

    # --- Domain 1 Tests: Points Ledger ---

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

    # --- Domain 2 Tests: Statement Billing ---

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

    # --- Domain 3 Tests: Settlement Tracker ---

    def test_settlement_valid_passes(self):
        logs = verify_settlement_tracker_invariants(self.valid_settlement)
        self.assertTrue(len(logs) >= 1)

    def test_settlement_sum_mismatch_fails(self):
        st = copy.deepcopy(self.valid_settlement)
        st["total_amount_krw"] = 300000  # does not match item sum
        with self.assertRaises(InvariantError) as ctx:
            verify_settlement_tracker_invariants(st)
        self.assertIn("SETTLEMENT_ITEM_SUM_VIOLATION", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
