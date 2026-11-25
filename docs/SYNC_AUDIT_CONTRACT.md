# Sync run records (실행 기록) contract
> The separate run-report endpoint `/api/sync-runs` 는 12단계에서 제거(2026-11-25). 실행 기록은 이제 v2 수신(`POST /api/ingest`, [INGEST_V2.md](INGEST_V2.md))이 항목과 함께 저장한다.

Status: in production. Every active collector dataset sends v2 bodies to `POST /api/ingest` (confirmed 2026-11-25); no collector uses the removed separate report.

## Migration
The run record table `dashboard_sync_runs` is defined in `supabase/migrations/20261112000100_sync_runs.sql` (`commit_source` column added by `20261124000000_ingest_commit.sql`). Empty development DB: apply every file in `supabase/migrations/` in name order. Existing production DB: check applied state with the procedure in `supabase/README.md`. The table has RLS; collectors never write it directly. `/api/ingest` v2 depends on this table: the commit function `dashboard_ingest_commit` writes the item rows and the run record in the same transaction, so ingest is unavailable (503) if the table or function is missing.

## Collector flow
1. Assign a UUID run_id for each collection execution. The run key is `(run_id, dataset, source_system)`. Put the same `run_id` and `source_system` in `run` and in every `items[].metadata`, together with as_of, verified_at and the required provenance.
2. Send one v2 body — `{version:2, run, items, manifest}` — to `POST /api/ingest` with the ingest Bearer token. Items and the run record are stored together in one transaction (all or nothing). Do not send credentials in the body or GitHub.
3. For success (`run.status` "success"): send 1+ items and `manifest.item_count` equal to the item count. Check the response: HTTP 200, `run.status` "success", `upserted` equal to `manifest.item_count` (1 or more). A 200 alone is not proof of storage.
4. For a collection failure: send `run.status` "failed" with an `error_code`, `items` with 0 entries and `manifest.item_count` 0 (`source_as_of` null when unknown). Do not create any fake item. The response is 200 with `upserted` 0; it records the failed run only.
5. Resending the exact same body (e.g. after a lost response) is idempotent: 200 `idempotent:true`, `upserted` 0, nothing rewritten. A different body is a different run — use a new `run_id` (and update every `items[].metadata.run_id`). Reusing a key with a different body returns `409 RUN_ID_CONFLICT`.
6. Older run records written by the removed `/api/sync-runs` have `commit_source = 'report'`. If a v2 body uses the same run key as such a 'report' record, v2 returns `409 RUN_ID_CONFLICT` even if the digest matches — send it under a new `run_id`.
7. 실행 기록 요약은 /api/dashboard 응답의 syncHealth(대시보드 상태 요약)와 기록 탭의 수집 기록으로 본다. No collector credentials in browser. Do not claim source verification based solely on a successful run.

Example (fictional schema example, not production data — failed run, no items):
```json
{
 "version":2,
 "run":{
  "run_id":"00000000-0000-4000-8000-000000000002",
  "dataset":"transactions",
  "source_system":"samsungcard",
  "source_as_of":null,
  "collected_at":"2026-01-01T09:10:00+09:00",
  "status":"failed",
  "error_code":"SOURCE_TIMEOUT"
 },
 "items":[],
 "manifest":{"item_count":0,"amount_total":null}
}
```
The server stores a `payload_digest` of the received items; it identifies the bytes sent, not independent proof of the source.

## Freshness
GET /api/dashboard returns updates (DB write time) and sourceUpdates (latest valid metadata.as_of from visible records per section). The UI labels these separately. Older legacy records lacking provenance show source time as unconfirmed. The latest timestamp is not evidence every provider was updated or reconciled. Per-source run histories are required for complete freshness.

## Next: independent evidence and reconciliation
- A statement total provided by the same collector is internal consistency, not independent proof. Compare like-for-like billing month, account, currency, settlement status, amount definition and complete statement scope. Separate purchase approval and installment billed amount; gross, points/credits and net due are distinct. Do not compare a partial chunk to an entire statement. Stage complete runs before atomic publish (phase 2/4).
- A SHA-256 hash of a collector-provided ledger proves identity of bytes only if compared to an independently obtained trusted original. It does not prove origin, and hashing normalized text alone cannot prove the original file. Agree on independently obtained statement/evidence, a trusted verifier or explicit user approval bound to run ID, evidence hash and canonical payload digest. Do not store raw card details in GitHub.
- Point invariant mismatch indicates missing/misclassified data, not automatically fraud. Handle unknown previous balance, provider-specific units, expiration/adjustments, date boundaries and complete event scope; retain last valid snapshot until resolved.
- Missing a monthly subscription card charge is not proof of pause (billing date, annual plan, trial, alternative payment, FX, delayed posting). Match only comparable settled charges; mark unmatched/unknown and verify actual subscription status. Do not auto-pause without explicit source evidence.
- Current stage 0 structural checks do not stop plausible invented evidence; independent proof and fail-closed staging are outstanding. No "100% verified" badge until independent verification passes.
