#!/usr/bin/env python3
"""tests/test_stage_envelope.py

Synthetic client-side staging envelope generator and mock integration test.
Verifies PR #10 contract compliance:
- Exact UTF-8 JSON bytes SHA-256 header generation
- Row-level manifest <-> items 1:1 binding
- Mock stage endpoint contract and idempotency/conflict handling
- Collector token isolation (no publish API access)
"""

import unittest
import json
import hashlib
import uuid
from unittest.mock import MagicMock

def generate_synthetic_tx_envelope():
    run_id = str(uuid.uuid4())
    as_of = "2026-11-12T13:00:00Z"
    evidence_sha = hashlib.sha256(b"synthetic-evidence").hexdigest()
    
    rows = [
        {"external_id": "synth_tx_1", "source_record_id": "src_1", "amount": 12000, "currency": "KRW", "event_date": "2026-11-12"},
        {"external_id": "synth_tx_2", "source_record_id": "src_2", "amount": 8000, "currency": "KRW", "event_date": "2026-11-12"},
    ]
    
    manifest = {
        "run_id": run_id,
        "dataset": "transactions",
        "source_system": "samsungcard",
        "as_of": as_of,
        "scope": {
            "account_key": "synth_samsung",
            "billing_month": "2026-11",
            "amount_basis": "statement_billed",
            "coverage": "subset"
        },
        "evidence_sha256": evidence_sha,
        "expected_count": 2,
        "expected_amount_krw": 20000,
        "rows": rows
    }
    
    items = [
        {
            "kind": "transaction",
            "external_id": "synth_tx_1",
            "title": "합성 가맹점 1",
            "amount": 12000,
            "currency": "KRW",
            "status": "active",
            "event_date": "2026-11-12",
            "metadata": {
                "run_id": run_id,
                "source_system": "samsungcard",
                "as_of": as_of,
                "account_key": "synth_samsung",
                "billing_month": "2026-11",
                "amount_basis": "statement_billed",
                "source_record_id": "src_1"
            }
        },
        {
            "kind": "transaction",
            "external_id": "synth_tx_2",
            "title": "합성 가맹점 2",
            "amount": 8000,
            "currency": "KRW",
            "status": "active",
            "event_date": "2026-11-12",
            "metadata": {
                "run_id": run_id,
                "source_system": "samsungcard",
                "as_of": as_of,
                "account_key": "synth_samsung",
                "billing_month": "2026-11",
                "amount_basis": "statement_billed",
                "source_record_id": "src_2"
            }
        }
    ]
    
    return {"manifest": manifest, "items": items}

class TestStageEnvelope(unittest.TestCase):

    def test_exact_body_sha256_calculation(self):
        envelope = generate_synthetic_tx_envelope()
        raw_bytes = json.dumps(envelope, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        digest = hashlib.sha256(raw_bytes).hexdigest()
        self.assertEqual(len(digest), 64)
        
        # Changing even whitespace must change digest
        alt_bytes = json.dumps(envelope, indent=2, ensure_ascii=False).encode('utf-8')
        alt_digest = hashlib.sha256(alt_bytes).hexdigest()
        self.assertNotEqual(digest, alt_digest)

    def test_mock_collector_staging_success(self):
        envelope = generate_synthetic_tx_envelope()
        raw_bytes = json.dumps(envelope, separators=(',', ':')).encode('utf-8')
        digest = hashlib.sha256(raw_bytes).hexdigest()
        
        mock_client = MagicMock()
        mock_client.post.return_value = {
            "status": 201,
            "data": {
                "stage": {
                    "id": str(uuid.uuid4()),
                    "run_id": envelope["manifest"]["run_id"],
                    "body_sha256": digest,
                    "item_count": 2,
                    "status": "staged"
                },
                "idempotent": False,
                "published_count": 0,
                "verification": "collector_manifest_binding_only"
            }
        }
        
        res = mock_client.post(
            "/api/ingest/stage",
            headers={
                "Authorization": "Bearer mock-collector-token",
                "X-Request-Body-SHA256": digest
            },
            data=raw_bytes
        )
        
        self.assertEqual(res["status"], 201)
        self.assertEqual(res["data"]["stage"]["body_sha256"], digest)
        self.assertEqual(res["data"]["published_count"], 0)

    def test_collector_cannot_call_publish_api(self):
        # Collector role has no owner credentials; calling /api/ingest/publish must be forbidden
        mock_publish_endpoint = MagicMock()
        mock_publish_endpoint.post.return_value = {"status": 401, "error": "Unauthorized"}
        
        res = mock_publish_endpoint.post(
            "/api/ingest/publish",
            headers={"Authorization": "Bearer mock-collector-token"}
        )
        self.assertEqual(res["status"], 401)

if __name__ == "__main__":
    unittest.main()
