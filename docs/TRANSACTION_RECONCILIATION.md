# Phase 2 — transaction identity and statement reconciliation (initial read-only implementation)

This implementation deliberately does not change the meaning of existing amount fields or delete/merge legacy transactions.

## Strong identity
For a provider-issued stable transaction/statement-line ID, include metadata:
- source_system: samsungcard
- account_key: stable non-sensitive account/card alias, not full card number
- billing_month: YYYY-MM (statement scope, NOT inferred from approval date)
- amount_basis: statement_billed or purchase_approval
- source_record_id: provider-issued stable ID for the line
- source_record_id_type: provider
- currency: KRW in top-level item, signed integer amount in KRW.

For installment, refund and cancellation rows, the ID must identify the actual line at the given scope, not merely the parent purchase. Purchase approval and billed installment are different representations; **do not put both representations into the same active transaction list and double count**. Agree amount semantics before backfill. A fallback hash of time/merchant/amount is not provider-issued and must be marked fingerprint; it is not automatically merged or rejected as a duplicate. Two legitimate equal payments can coexist.

Ingest checks scoped strong identity across incoming rows and existing active rows and rejects another external_id with HTTP 409 DUPLICATE_SOURCE_TRANSACTION. Same external_id remains idempotent. This is an application-level check; concurrent writes can race. A database-level unique constraint and transactional publish require a later migration after legacy conflicts are audited. Do not auto-delete existing duplicates.

## Read-only endpoint
POST /api/reconcile/transactions, existing ingest Bearer auth. No DB writes, no new data, no approval.
Body example (fictional schema only):
```json
{"scope":{"source_system":"samsungcard","account_key":"card-alias","billing_month":"2026-11","amount_basis":"statement_billed","currency":"KRW"},"expected_count":2,"expected_total":12000,"rows":[{"source_record_id":"provider-line-1","amount":10000},{"source_record_id":"provider-line-2","amount":2000}]}
```
Submit complete official statement manifest for the identical account, billing month, currency and amount basis. Maximum 5000 rows per request. The server compares count and signed total, missing/extra/duplicate IDs, amount mismatches, invalid identity/amount and records with unmapped scope. Scope match is NOT independent source verification: the collector supplies the manifest. Unmapped legacy records are reported and not guessed from event_date. Only explicit comparable records enter scope. No automatic deletion or correction; resolve via reviewed backfill using same external_id. If official line IDs do not exist, report that limitation instead of inventing IDs. Do not run a real write merely to test.

## Dashboard transaction pagination
All transaction pages retrieved by stable ID cursor (500 each) before aggregates are computed. Other groups still have separate 500-row limits. Current dashboard reads are not transactional snapshots and return all transaction rows to browser; very large history needs a month-specific API and server-side aggregates. Do not describe this as a complete scalable solution.

## Next steps
- PickleAI confirms provider-issued line IDs, account alias, billed vs approved amount, statement month, signs and complete source manifest. Clarify 94 statement rows vs other approved transactions and gross/credit/net definitions.
- Compare read-only, first report unmapped/duplicate candidates and differences. No automatic backfill without agreement.
- Separate trusted verifier/user-approved source evidence; staging plus atomic publish and durable DB uniqueness to follow. This phase is not a claim of independent verification.
