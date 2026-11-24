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
3. ChatGPT reads the relevant Issue when the user requests action, implements fixes in a pull request (PR) targeting `main`, and posts exact commit references and required JSON contract changes.
4. Pickle AI tests the compatible **preview/staging endpoint** if available, and posts a pass/fail comment; the owner approves the release. Never point Pickle AI at preview with the **production** ingest secret.
5. Merge to `main` only after reviewed results. Vercel deploys `main` as production; each PR gets a Vercel Preview deployment (docs/DEPLOY.md (1)).
6. Issues are asynchronous **shared notes**, not direct autonomous AI-to-AI messages. Each AI needs its own GitHub connection and permission to read/write this **public** repository, so never put real data, tokens or production URLs in Issues or commits. ChatGPT does not continuously monitor Issues without a separate automation.

## Integration API

- 수집기 실행 전 `DASHBOARD_INGEST_BASE_URL` 설정(https origin), 실제 POST 경로 `/api/ingest`
- Header: `Authorization: Bearer <PICKLE_INGEST_TOKEN>`
- Header: `Content-Type: application/json`
- Request body: 지금은 v1 — `examples/pickle-payload-v1.json`, v2 — `examples/pickle-payload.json`([INGEST_V2.md](INGEST_V2.md))
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
- 화면 검사는 `npm run screens`가 합성 세션과 가짜 `/api/dashboard` 응답으로 `/`를 본다.
- The UI currently refreshes production data every 60 seconds.
- v2 규격: docs/INGEST_V2.md (`"version": 2` 본문, 같은 `POST /api/ingest`).
- v1 은 지금 사용한다. v2 로 바꾸는 것은 [DEPLOY.md](DEPLOY.md) (3) 배포 후 확인이 끝난 뒤에만 [INGEST_V2.md](INGEST_V2.md) ⑪ 전환 확인 절차를 따라 한다.
- v2 로 보내는 실행은 `/api/sync-runs` 로 따로 보고하지 않는다(피클AI 의 별도 실행 보고를 끈다).
- 같은 실행 키가 `/api/sync-runs` 로 먼저 보고되면 v2 는 `409 RUN_ID_CONFLICT` 가 된다([INGEST_V2.md](INGEST_V2.md) ⑤·⑪).

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

- `main`: production (user-facing, genuine data). Every change goes through a pull request (PR) targeting `main`.
- Preview: Vercel PR preview deployments only; never use production credentials (ingest token, service role key) in Preview.
- This repository is public; never commit real data, tokens or production URLs.

**No automatic cross-agent polling is configured by this document.** Agents only act when invoked or when a separately configured automation runs.
