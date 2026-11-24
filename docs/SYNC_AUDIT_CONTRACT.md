# Phase 1 — Sync run reporting contract
Status: implementation committed; Supabase migration and live integration must be verified.

## Migration
The table is defined in `supabase/migrations/20261112000100_sync_runs.sql`. Empty development DB: apply every file in `supabase/migrations/` in name order. Existing production DB: applied state is unconfirmed — the operator decides with the check procedure in `supabase/README.md` and applies only what is needed. It adds an audit table only, with RLS; it does not change existing business records. Until then GET/POST /api/sync-runs returns 503. Ordinary dashboard reads/ingest are independent of this table.

## Collector flow
1. Assign a UUID run_id for each collection execution. Keep a dataset/source pair consistent across all chunks. Include run_id, source_system, as_of, verified_at and the required provenance in all ingest rows. Use validate_only before production writes.
2. After all chunks are finished, POST /api/sync-runs with the existing ingest Bearer token. Send the report immediately, before a later run overwrites those same items. Do not send credentials in the body or GitHub.
3. For a collection failure, send status=failed, received_count=0, rejected_count=0, an error_code, expected_count=null if unknown, source_as_of/collected_at=null when unknown. Do not create any fake item. For partial, report actual expected/received/rejected counts, nullable expected if unknown, and error_code. A quarantined run has not been released as verified data; current API does not implement a staging store, so do not submit it to ingest.
4. For success, source_as_of and collected_at required, expected_count=received_count, rejected_count=0. The server compares the number of persisted records matching run_id/dataset/source with expected_count. This counts stored records including tombstones; it is not independent verification of the source. The report does not overwrite business records.
5. Final run records are immutable, exact retries return the stored record, changed reports require a new run ID. This is final reporting, not streaming progress. Do not claim source verification based solely on a successful report.
6. GET /api/sync-runs uses authenticated dashboard session and returns own latest 200 runs; no collector credentials in browser. UI integration follows migration and API QA.

Example (fictional schema example, not production data):
```json
{
 "run_id":"b4df4f59-3c11-4abf-814c-45ec4eb41234",
 "dataset":"transactions",
 "source_system":"samsungcard",
 "source_as_of":"2026-11-12T06:00:00+09:00",
 "collected_at":"2026-11-12T06:05:00+09:00",
 "status":"failed",
 "expected_count":null,
 "received_count":0,
 "rejected_count":0,
 "error_code":"SOURCE_AUTH_EXPIRED",
 "payload_digest":null
}
```
The digest is a collector-provided reference only; it is not independent proof.

## Freshness
GET /api/dashboard returns updates (DB write time) and sourceUpdates (latest valid metadata.as_of from visible records per section). The UI labels these separately. Older legacy records lacking provenance show source time as unconfirmed. The latest timestamp is not evidence every provider was updated or reconciled. Per-source run histories are required for complete freshness.

## Next: independent evidence and reconciliation
- A statement total provided by the same collector is internal consistency, not independent proof. Compare like-for-like billing month, account, currency, settlement status, amount definition and complete statement scope. Separate purchase approval and installment billed amount; gross, points/credits and net due are distinct. Do not compare a partial chunk to an entire statement. Stage complete runs before atomic publish (phase 2/4).
- A SHA-256 hash of a collector-provided ledger proves identity of bytes only if compared to an independently obtained trusted original. It does not prove origin, and hashing normalized text alone cannot prove the original file. Agree on independently obtained statement/evidence, a trusted verifier or explicit user approval bound to run ID, evidence hash and canonical payload digest. Do not store raw card details in GitHub.
- Point invariant mismatch indicates missing/misclassified data, not automatically fraud. Handle unknown previous balance, provider-specific units, expiration/adjustments, date boundaries and complete event scope; retain last valid snapshot until resolved.
- Missing a monthly subscription card charge is not proof of pause (billing date, annual plan, trial, alternative payment, FX, delayed posting). Match only comparable settled charges; mark unmatched/unknown and verify actual subscription status. Do not auto-pause without explicit source evidence.
- Current stage 0 structural checks do not stop plausible invented evidence; independent proof and fail-closed staging are outstanding. No "100% verified" badge until independent verification passes.
