# ChatGPT × Pickle AI collaboration protocol

This repository is the **single source of truth for software development and integration contracts** for PERSONAL OS.

## Responsibilities

| Actor | Responsible for | Does not do |
| --- | --- | --- |
| ChatGPT | Next.js UI, API contracts, data validation, DB schema, bug fixes, code reviews | Access the user's financial credentials or silently use production data |
| Pickle AI | Read connected user apps (as authorized), normalize source data, POST changes to the ingest API, report integration results | Modify dashboard code or database schema without an agreed GitHub Issue |
| Project owner | Approve priorities, connect GitHub accounts, set secrets in secure providers, approve production changes | Paste secrets into Issues or commit them |

## Communication: GitHub Issues

1. Every integration problem or feature change gets an Issue. Use the **Data sync handoff** or **Dashboard change** template.
2. Pickle AI reports only **sanitized** HTTP status, source category, example *fictional* JSON, and timestamp. No real transactions, account IDs, personal data, headers, token values, cookie values, screenshots with secrets, or original app credentials.
3. ChatGPT reads the relevant Issue when the user requests action, implements fixes on `develop`, and posts exact commit references and required JSON contract changes.
4. Pickle AI tests the compatible **preview/staging endpoint** if available, and posts a pass/fail comment; the owner approves the release. Never point Pickle AI at preview with the **production** ingest secret.
5. Merge to `main` only after reviewed results. Vercel deploys `main` as production; `develop` is intended for Vercel Preview builds.
6. Issues are asynchronous **shared notes**, not direct autonomous AI-to-AI messages. Each AI needs its own GitHub connection and permission to read/write this **private** repository. ChatGPT does not continuously monitor Issues without a separate automation.

## Integration API

- 수집기 실행 전 `DASHBOARD_INGEST_BASE_URL` 설정(https origin), 실제 POST 경로 `/api/ingest`
- Header: `Authorization: Bearer <PICKLE_INGEST_TOKEN>`
- Header: `Content-Type: application/json`
- Request body: 지금(8단계 전)은 v1 — `examples/pickle-payload-v1.json`, v2 는 운영 반영 뒤 — `examples/pickle-payload.json`([INGEST_V2.md](INGEST_V2.md))
- 예시는 형식 확인용 합성 값이다. 운영 전송 본문은 수집기가 실제로 검증한 원천 레코드로 만든다([examples/README.md](../examples/README.md)).
- v1: Root structure: `{"items":[...]}` (1–100 records per request). v2 root structure: [INGEST_V2.md](INGEST_V2.md).
- `kind`: `transaction | settlement | news | benefit | task | event | journal`.
- `external_id`: stable, unique per item within the same `kind`; **do not generate new IDs on each sync**.
- `title`: required string. `amount`: number, not a formatted currency string. `status`: `pending | done | active | archived`.
- `event_date` and `due_date`: `YYYY-MM-DD`, when supplied.
- Ingest currently upserts all supplied items, but **does not delete records omitted from subsequent batches**.
- Field updates (v1 and v2): each item updates only the keys it sends; omitted optional fields (`description`, `amount`, `category`, `source`, `event_date`, `due_date`, `url`) keep their stored value, and an explicit `null` writes null. v1 always sends `currency`, `status`, `metadata` (schema defaults). Earlier batch upserts wrote null for a key that only other items in the same batch sent; that no longer happens. See docs/INGEST_V2.md ⑦.
- If the stored row changed between the ingest checks and the write, the request fails with `409 {"code":"CONCURRENT_CHANGE"}`; resend the batch.
- Existing completed settlements and tasks are preserved against normal resync by a best-effort merge. **Concurrent ingest and user status changes can race.** Do not assume strict transactional safety yet.
- The `/demo` page uses fabricated, client-local records and **never calls the production ingest or update APIs**.
- The UI currently refreshes production data every 60 seconds.
- v2 규격: docs/INGEST_V2.md (`"version": 2` 본문, 같은 `POST /api/ingest`). 운영 반영은 8단계(운영 DB 마이그레이션 적용 후); 그 전까지는 v1 사용

## Issue format

**Source / Area**:
**Observed vs Expected**:
**Sanitized reproduction**:
**HTTP status and error text**:
**Related external_id (synthetic only)**:
**Timestamp, timezone**:
**Affected schema fields**:
**Proposed fix**:
**Acceptance criteria**:
**Next action owner (ChatGPT / Pickle AI / owner)**:

Do not publish tokens or secret environment variables in repo files or Issue comments. Configure provider secrets only through the providers' secure settings.

## Default branches

- `main`: production (user-facing, genuine data).
- `develop`: review-ready changes for preview; avoid production API credentials in Preview environments.

**No automatic cross-agent polling is configured by this document.** Agents only act when invoked or when a separately configured automation runs.
