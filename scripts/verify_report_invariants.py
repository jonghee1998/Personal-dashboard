#!/usr/bin/env python3
"""
verify_report_invariants.py

Automated mechanical invariant verifier across financial domains:
1. Points Ledger (삼성카드, 네이버페이)
2. Statement Billing (청구서 대사)
3. Settlement Tracker (여행 등 정산)

Fail-closed design:
- Missing fields fail immediately (no defaults).
- Strict integer type checking (booleans, strings, floats rejected).
- All domain partitions and arithmetic balance invariants enforced.
"""

import sys
import re
import json
from typing import Dict, Any, List

BILLING_MONTH_REGEX = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

class InvariantError(Exception):
    """Raised when any structural or arithmetic invariant is violated."""
    pass

def _require_int(data: Dict[str, Any], key: str, allow_negative: bool = False) -> int:
    if key not in data:
        raise InvariantError(f"MISSING_REQUIRED_FIELD: {key}")
    val = data[key]
    if type(val) is not int:  # Reject bool (bool is subclass of int in Python)
        raise InvariantError(f"TYPE_MISMATCH: {key} must be int, got {type(val).__name__} ({val!r})")
    if not allow_negative and val < 0:
        raise InvariantError(f"NEGATIVE_NOT_ALLOWED: {key} must be non-negative, got {val}")
    return val

def _require_str(data: Dict[str, Any], key: str) -> str:
    if key not in data:
        raise InvariantError(f"MISSING_REQUIRED_FIELD: {key}")
    val = data[key]
    if not isinstance(val, str) or not val.strip():
        raise InvariantError(f"TYPE_MISMATCH: {key} must be non-empty str, got {val!r}")
    return val.strip()

# ---------------------------------------------------------------------------
# Domain 1: Points Ledger
# ---------------------------------------------------------------------------

ALLOWED_POINT_PROVIDERS = {"samsungcard", "naverpay"}

def verify_points_ledger_invariants(data: Dict[str, Any]) -> List[str]:
    logs = []
    provider = _require_str(data, "provider")
    if provider not in ALLOWED_POINT_PROVIDERS:
        raise InvariantError(f"UNAUTHORIZED_POINT_PROVIDER: {provider} not in {ALLOWED_POINT_PROVIDERS}")

    prev_bal = _require_int(data, "previous_balance")
    inc_amt = _require_int(data, "increase_amount")
    dec_amt = _require_int(data, "decrease_amount")
    curr_bal = _require_int(data, "current_balance")

    _require_str(data, "verified_at")
    _require_str(data, "as_of")

    expected_curr = prev_bal + inc_amt - dec_amt
    if expected_curr != curr_bal:
        raise InvariantError(f"POINT_DELTA_INVARIANT_VIOLATION: {prev_bal} + {inc_amt} - {dec_amt} = {expected_curr} != current_balance ({curr_bal})")
    logs.append(f"Point delta invariant holds for {provider}: {prev_bal} + {inc_amt} - {dec_amt} == {curr_bal}")

    return logs

# ---------------------------------------------------------------------------
# Domain 2: Statement Billing Reconciliation
# ---------------------------------------------------------------------------

def verify_statement_billing_invariants(data: Dict[str, Any]) -> List[str]:
    logs = []
    _require_str(data, "account_key")
    month = _require_str(data, "billing_month")
    if not BILLING_MONTH_REGEX.match(month):
        raise InvariantError(f"INVALID_BILLING_MONTH: expected YYYY-MM, got {month!r}")

    domestic_lump = _require_int(data, "domestic_lump_sum_krw")
    overseas_lump = _require_int(data, "overseas_lump_sum_krw")
    installment_principal = _require_int(data, "installment_principal_krw")
    fee = _require_int(data, "fee_krw")
    point_deduction = _require_int(data, "point_deduction_krw")
    total_billed = _require_int(data, "total_billed_krw")
    net_due = _require_int(data, "net_due_krw")

    # Invariant A: Total Billed = Principal Sum + Fees
    computed_total = domestic_lump + overseas_lump + installment_principal + fee
    if computed_total != total_billed:
        raise InvariantError(f"STATEMENT_TOTAL_INVARIANT_VIOLATION: principal+fee={computed_total} != total_billed={total_billed}")
    logs.append(f"Statement total invariant holds: {domestic_lump} + {overseas_lump} + {installment_principal} + {fee} == {total_billed}")

    # Invariant B: Net Due = Total Billed - Point Deductions
    computed_net = total_billed - point_deduction
    if computed_net != net_due:
        raise InvariantError(f"STATEMENT_NET_DUE_INVARIANT_VIOLATION: total-points={computed_net} != net_due={net_due}")
    logs.append(f"Statement net due invariant holds: {total_billed} - {point_deduction} == {net_due}")

    return logs

# ---------------------------------------------------------------------------
# Domain 3: Settlement Tracker
# ---------------------------------------------------------------------------

def verify_settlement_tracker_invariants(data: Dict[str, Any]) -> List[str]:
    logs = []
    _require_str(data, "trip_name")

    if "settlement_items" not in data or not isinstance(data["settlement_items"], list) or not data["settlement_items"]:
        raise InvariantError("MISSING_REQUIRED_FIELD: settlement_items (non-empty list required)")

    items = data["settlement_items"]
    tot_amt = _require_int(data, "total_amount_krw")
    collected = _require_int(data, "collected_amount_krw")
    pending = _require_int(data, "pending_amount_krw")

    sum_items = 0
    sum_paid = 0
    sum_unpaid = 0

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise InvariantError(f"INVALID_SETTLEMENT_ITEM: index {i} must be dict")
        _require_str(item, "target")
        amt = _require_int(item, "amount_krw")
        status = _require_str(item, "status")
        if status not in ("paid", "unpaid"):
            raise InvariantError(f"INVALID_SETTLEMENT_STATUS: item {i} status must be 'paid' or 'unpaid', got {status!r}")

        sum_items += amt
        if status == "paid":
            sum_paid += amt
        else:
            sum_unpaid += amt

    if sum_items != tot_amt:
        raise InvariantError(f"SETTLEMENT_ITEM_SUM_VIOLATION: sum(items)={sum_items} != total_amount_krw={tot_amt}")
    if sum_paid != collected:
        raise InvariantError(f"SETTLEMENT_COLLECTED_VIOLATION: sum(paid)={sum_paid} != collected_amount_krw={collected}")
    if sum_unpaid != pending:
        raise InvariantError(f"SETTLEMENT_PENDING_VIOLATION: sum(unpaid)={sum_unpaid} != pending_amount_krw={pending}")
    if collected + pending != tot_amt:
        raise InvariantError(f"SETTLEMENT_PARTITION_VIOLATION: {collected} + {pending} != {tot_amt}")

    logs.append(f"Settlement tracker invariant holds: {sum_paid} (paid) + {sum_unpaid} (unpaid) == {tot_amt} ({len(items)} items)")
    return logs

# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 verify_report_invariants.py <domain> <payload.json>")
        print("Domains: points, statement, settlement")
        sys.exit(1)

    domain = sys.argv[1]
    file_path = sys.argv[2]

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    try:
        if domain == "points":
            logs = verify_points_ledger_invariants(data)
        elif domain == "statement":
            logs = verify_statement_billing_invariants(data)
        elif domain == "settlement":
            logs = verify_settlement_tracker_invariants(data)
        else:
            raise InvariantError(f"UNKNOWN_DOMAIN: {domain}")

        print(f"[{domain.upper()}] ALL REPORT INVARIANTS SATISFIED:")
        for log in logs:
            print(f"  - {log}")
        sys.exit(0)
    except InvariantError as e:
        print(f"CRITICAL INVARIANT VIOLATION: {e}", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
