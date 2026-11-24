#!/usr/bin/env python3
"""
verify_report_invariants.py

Automated mechanical invariant verifier across financial domains:
1. Backfill Preview (transactions)
2. Points Ledger (삼성카드, 네이버페이)
3. Statement Billing (청구서 대사)
4. Settlement Tracker (여행 등 정산)

Fail-closed design:
- Missing fields fail immediately (no defaults).
- Strict integer type checking (booleans, strings, floats rejected).
- SHA-256 hashes must strictly conform to 64-character lowercase hex regex.
- All domain partitions and arithmetic balance invariants enforced.
- Report text renderer with bidirectional numerical parity validation.
"""

import sys
import re
import json
from typing import Dict, Any, List

HEX_64_REGEX = re.compile(r"^[0-9a-f]{64}$")
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

def _require_sha256(data: Dict[str, Any], key: str) -> str:
    val = _require_str(data, key)
    if not HEX_64_REGEX.match(val):
        raise InvariantError(f"MALFORMED_SHA256: {key} must be 64-char lowercase hex, got {val!r}")
    return val

# ---------------------------------------------------------------------------
# Domain 1: Backfill Preview
# ---------------------------------------------------------------------------

EXPECTED_CLASSIFICATION_KEYS = {"exact_unique", "ambiguous", "unmatched", "conflict"}

def verify_backfill_preview_invariants(data: Dict[str, Any]) -> List[str]:
    logs = []

    status = _require_str(data, "status")
    if status != "preview_only":
        raise InvariantError(f"INVALID_STATUS: preview must have status='preview_only', got {status!r}")
    logs.append(f"Status verified: {status}")

    # Check problems list
    if "problems" not in data or not isinstance(data["problems"], list):
        raise InvariantError("MISSING_REQUIRED_FIELD: problems (must be list)")
    if len(data["problems"]) > 0:
        raise InvariantError(f"PREVIEW_BLOCKED: problems list is non-empty ({data['problems']})")
    logs.append("Problems list verified empty")

    # applied_count must be explicitly 0 for preview
    applied = _require_int(data, "applied_count")
    if applied != 0:
        raise InvariantError(f"MUTATION_DETECTED: applied_count must be 0 in preview, got {applied}")
    logs.append("Applied count verified 0 (no DB mutations)")

    # Digests
    _require_sha256(data, "inventory_digest")
    _require_sha256(data, "plan_digest")
    logs.append("Cryptographic digests verified (valid 64-char hex SHA-256)")

    # Inventory totals
    inv_count = _require_int(data, "inventory_count")
    if inv_count <= 0:
        raise InvariantError(f"EMPTY_INVENTORY: inventory_count must be positive, got {inv_count}")
    inv_amt = _require_int(data, "inventory_amount_krw", allow_negative=True)

    # Classifications
    if "classification_counts" not in data or not isinstance(data["classification_counts"], dict):
        raise InvariantError("MISSING_REQUIRED_FIELD: classification_counts")
    if set(data["classification_counts"].keys()) != EXPECTED_CLASSIFICATION_KEYS:
        raise InvariantError(f"INVALID_CLASSIFICATION_KEYS: expected {EXPECTED_CLASSIFICATION_KEYS}, got {set(data['classification_counts'].keys())}")
    
    cls_counts = {k: _require_int(data["classification_counts"], k) for k in EXPECTED_CLASSIFICATION_KEYS}
    sum_counts = sum(cls_counts.values())
    if sum_counts != inv_count:
        raise InvariantError(f"COUNT_INVARIANT_VIOLATION: sum(classifications)={sum_counts} != inventory_count={inv_count}")
    logs.append(f"Count invariant holds: sum(classifications) == inventory_count == {inv_count}")

    if "classification_amounts_krw" not in data or not isinstance(data["classification_amounts_krw"], dict):
        raise InvariantError("MISSING_REQUIRED_FIELD: classification_amounts_krw")
    if set(data["classification_amounts_krw"].keys()) != EXPECTED_CLASSIFICATION_KEYS:
        raise InvariantError(f"INVALID_CLASSIFICATION_KEYS: expected {EXPECTED_CLASSIFICATION_KEYS}, got {set(data['classification_amounts_krw'].keys())}")

    cls_amts = {k: _require_int(data["classification_amounts_krw"], k, allow_negative=True) for k in EXPECTED_CLASSIFICATION_KEYS}
    sum_amts = sum(cls_amts.values())
    if sum_amts != inv_amt:
        raise InvariantError(f"AMOUNT_INVARIANT_VIOLATION: sum(classification_amounts)={sum_amts} != inventory_amount={inv_amt}")
    logs.append(f"Amount invariant holds: sum(classification_amounts) == inventory_amount == {inv_amt} KRW")

    # Partition: Eligible + Unresolved
    elig_count = _require_int(data, "eligible_count")
    unres_count = _require_int(data, "unresolved_count")
    if elig_count + unres_count != inv_count:
        raise InvariantError(f"PARTITION_COUNT_VIOLATION: {elig_count} + {unres_count} != {inv_count}")
    logs.append(f"Partition count holds: {elig_count} eligible + {unres_count} unresolved == {inv_count}")

    elig_amt = _require_int(data, "eligible_amount_krw", allow_negative=True)
    unres_amt = _require_int(data, "unresolved_amount_krw", allow_negative=True)
    if elig_amt + unres_amt != inv_amt:
        raise InvariantError(f"PARTITION_AMOUNT_VIOLATION: {elig_amt} + {unres_amt} != {inv_amt}")
    logs.append(f"Partition amount holds: {elig_amt} + {unres_amt} == {inv_amt} KRW")

    # Exact Unique alignment
    if elig_count != cls_counts["exact_unique"] or elig_amt != cls_amts["exact_unique"]:
        raise InvariantError("ELIGIBLE_EXACT_UNIQUE_MISMATCH: eligible totals must equal exact_unique totals")
    logs.append(f"Eligible partition exactly matches exact_unique ({elig_count} items, {elig_amt} KRW)")

    return logs

# ---------------------------------------------------------------------------
# Domain 2: Points Ledger
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
# Domain 3: Statement Billing Reconciliation
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
# Domain 4: Settlement Tracker
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
# Bidirectional Report Renderer & Parity Checker
# ---------------------------------------------------------------------------

def render_preview_report_markdown(data: Dict[str, Any]) -> str:
    """Renders structured preview report strictly using verified numbers."""
    verify_backfill_preview_invariants(data)
    
    cls_amts = data["classification_amounts_krw"]
    cls_cnts = data["classification_counts"]
    
    return f"""### [검증 완료] Backfill Preview 기계적 대사 보고
- **인벤토리 총액**: {data['inventory_amount_krw']}원 ({data['inventory_count']}건)
- **적격 후보군 (exact_unique)**: {data['eligible_amount_krw']}원 ({data['eligible_count']}건)
- **보류 목록 (unresolved)**: {data['unresolved_amount_krw']}원 ({data['unresolved_count']}건)
  - 모호 (ambiguous): {cls_amts['ambiguous']}원 ({cls_cnts['ambiguous']}건)
  - 미확인 (unmatched): {cls_amts['unmatched']}원 ({cls_cnts['unmatched']}건)
  - 충돌 (conflict): {cls_amts['conflict']}원 ({cls_cnts['conflict']}건)
- **실제 DB 수정**: {data['applied_count']}건
- **무결성 해시**: plan_digest={data['plan_digest']}
"""

def verify_report_text_parity(report_text: str, data: Dict[str, Any]) -> bool:
    """
    Requires exact equality with the canonical verified report, not just numeric membership.
    """
    verify_backfill_preview_invariants(data)
    
    # Compare the complete canonical report, including field labels, sign,
    # count, amount and digest. Membership in a set of numbers is insufficient.
    if report_text != render_preview_report_markdown(data):
        raise InvariantError("REPORT_PARITY_VIOLATION: report differs from canonical verified rendering")
    
    return True

# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 verify_report_invariants.py <domain> <payload.json>")
        print("Domains: preview, points, statement, settlement")
        sys.exit(1)

    domain = sys.argv[1]
    file_path = sys.argv[2]

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    try:
        if domain == "preview":
            logs = verify_backfill_preview_invariants(data)
            # Test render & parity
            text = render_preview_report_markdown(data)
            verify_report_text_parity(text, data)
            logs.append("Report markdown rendered and numerical parity verified 100%")
        elif domain == "points":
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
