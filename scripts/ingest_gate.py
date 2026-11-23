#!/usr/bin/env python3
"""
ingest_gate.py

Strict execution gate for all Ingest and Sync API transmissions.
Enforces:
1. Strict HTTPS host/path allowlist (prevents token leakage to arbitrary URLs, rejects redirects).
2. Cryptographic and mathematical binding between verified manifest and items payload.
3. Fail-closed network isolation: on any invariant error, network call count is strictly 0.
4. Synthetic fixture compatibility for automated regression tests.
"""

import sys
import os
import re
import json
import hashlib
from typing import Dict, Any, List, Optional
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_report_invariants import (
    verify_backfill_preview_invariants,
    verify_points_ledger_invariants,
    verify_statement_billing_invariants,
    verify_settlement_tracker_invariants,
    InvariantError
)

ALLOWED_INGEST_ENDPOINTS = {
    "https://private-dashboard-ivory.vercel.app/api/ingest",
    "https://private-dashboard-ivory.vercel.app/api/sync-runs",
    "https://private-dashboard-ivory.vercel.app/api/backfill/preview",
}

class IngestGateError(InvariantError):
    pass

class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuses any HTTP redirect to prevent silent token or payload leakage."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise IngestGateError(f"HTTP_REDIRECT_FORBIDDEN: redirects are not permitted ({code} -> {newurl})")

def canonical_json_bytes(obj: Any) -> bytes:
    """Produces deterministic UTF-8 bytes for cryptographic digest binding."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def compute_payload_digest(items: List[Dict[str, Any]]) -> str:
    return hashlib.sha256(canonical_json_bytes(items)).hexdigest()

def validate_endpoint_url(url: str) -> None:
    if not isinstance(url, str) or not url.strip():
        raise IngestGateError("ENDPOINT_URL_REQUIRED: endpoint_url must be non-empty string")
    clean_url = url.strip()
    if clean_url not in ALLOWED_INGEST_ENDPOINTS:
        raise IngestGateError(f"UNAUTHORIZED_ENDPOINT: {clean_url!r} is not in allowlist: {ALLOWED_INGEST_ENDPOINTS}")

def bind_and_verify_ingest_payload(
    domain: str,
    manifest: Dict[str, Any],
    items: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Validates manifest invariants and verifies mathematical/digest binding to items.
    Returns audit metadata binding manifest and payload.
    """
    if not isinstance(items, list):
        raise IngestGateError("ITEMS_MUST_BE_LIST: payload items must be a list")

    # Step 1: Validate domain manifest invariants
    if domain == "points":
        verify_points_ledger_invariants(manifest)
        expected_count = 1
        expected_amount = manifest["current_balance"]
    elif domain == "statement":
        verify_statement_billing_invariants(manifest)
        expected_count = manifest.get("expected_item_count")
        if type(expected_count) is not int or expected_count <= 0:
            raise IngestGateError("STATEMENT_COUNT_REQUIRED")
        # Transaction list stores billed principal, not separately reported fees.
        if manifest.get("item_amount_basis") != "statement_principal":
            raise IngestGateError("STATEMENT_AMOUNT_BASIS_REQUIRED")
        expected_amount = manifest["total_billed_krw"] - manifest["fee_krw"]
    elif domain == "settlement":
        verify_settlement_tracker_invariants(manifest)
        expected_count = len(manifest["settlement_items"])
        expected_amount = manifest["total_amount_krw"]
    else:
        raise IngestGateError(f"UNSUPPORTED_INGEST_DOMAIN: {domain}")

    # Step 2: Bind items to manifest
    if len(items) != expected_count:
        raise IngestGateError(f"ITEM_COUNT_BINDING_MISMATCH: items count={len(items)} != manifest expected={expected_count}")

    # Calculate monetary sum across items
    item_amt_sum = 0
    for idx, it in enumerate(items):
        if not isinstance(it, dict):
            raise IngestGateError(f"INVALID_ITEM_AT_INDEX_{idx}: item must be dict")
        amt = it.get("amount")
        if type(amt) is not int:
            raise IngestGateError(f"INVALID_ITEM_AMOUNT_AT_{idx}: amount must be int, got {type(amt).__name__}")
        if domain == "points":
            meta = it.get("metadata")
            if (it.get("kind") != "benefit" or it.get("category") != "points"
                or not isinstance(meta, dict) or meta.get("source_system") != manifest["provider"]
                or meta.get("provider") != ("삼성카드" if manifest["provider"] == "samsungcard" else "네이버페이")
                or meta.get("as_of") != manifest["as_of"]):
                raise IngestGateError("POINTS_IDENTITY_BINDING_MISMATCH")
        if domain == "statement":
            meta = it.get("metadata")
            if (it.get("kind") != "transaction" or it.get("currency") != "KRW"
                or not isinstance(meta, dict) or meta.get("source_system") != "samsungcard"
                or meta.get("account_key") != manifest["account_key"]
                or meta.get("billing_month") != manifest["billing_month"]
                or meta.get("amount_basis") != "statement_billed"):
                raise IngestGateError("STATEMENT_SCOPE_BINDING_MISMATCH")
        item_amt_sum += amt

    # If domain enforces amount binding against manifest
    if domain == "points" and item_amt_sum != expected_amount:
        raise IngestGateError(f"POINTS_AMOUNT_BINDING_MISMATCH: item amount={item_amt_sum} != manifest={expected_amount}")
    elif domain == "statement" and item_amt_sum != expected_amount:
        raise IngestGateError(f"STATEMENT_AMOUNT_BINDING_MISMATCH: item sum={item_amt_sum} != principal={expected_amount}")
    elif domain == "settlement" and item_amt_sum != expected_amount:
        raise IngestGateError(f"SETTLEMENT_AMOUNT_BINDING_MISMATCH: item sum={item_amt_sum} != manifest={expected_amount}")

    payload_digest = compute_payload_digest(items)

    return {
        "domain": domain,
        "item_count": len(items),
        "item_amount_sum": item_amt_sum,
        "payload_digest": payload_digest,
        "binding_verified": True
    }

def transmit_gated_ingest(
    endpoint_url: str,
    token: str,
    domain: str,
    manifest: Dict[str, Any],
    items: List[Dict[str, Any]],
    validate_only: bool = False,
    opener: Optional[urllib.request.OpenerDirector] = None
) -> Dict[str, Any]:
    """
    Fail-closed execution pipeline:
    1. Validates endpoint against HTTPS allowlist.
    2. Enforces manifest invariants & cryptographic items binding.
    3. ONLY if all checks pass, performs network transmission with redirect disabled.
    """
    # Fail-closed step 1: Validate destination URL allowlist
    validate_endpoint_url(endpoint_url)
    if endpoint_url != "https://private-dashboard-ivory.vercel.app/api/ingest":
        raise IngestGateError("INGEST_ENDPOINT_REQUIRED")

    if not isinstance(token, str) or not token.strip():
        raise IngestGateError("BEARER_TOKEN_REQUIRED")

    # Fail-closed step 2: Invariant and binding verification
    audit = bind_and_verify_ingest_payload(domain, manifest, items)

    # Prepare ingest body
    body = {
        "items": items,
        "validate_only": validate_only
    }
    encoded_body = canonical_json_bytes(body)
    audit["request_body_sha256"] = hashlib.sha256(encoded_body).hexdigest()

    req = urllib.request.Request(
        endpoint_url,
        data=encoded_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token.strip()}",
            "X-Payload-Digest": audit["payload_digest"],
            "X-Request-Body-SHA256": audit["request_body_sha256"]
        }
    )

    if opener is None:
        opener = urllib.request.build_opener(NoRedirectHandler)

    with opener.open(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        res_data["_gate_audit"] = audit
        return res_data
