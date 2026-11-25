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
- Request body: v2 — `examples/pickle-payload.json`([INGEST_V2.md](INGEST_V2.md)). `version` 이 숫자 2 가 아닌 본문(옛 v1 형식)은 `410 v1 ingest removed` 로 거부된다(v1 수신은 12단계에서 제거, 2026-11-25).
- 예시는 형식 확인용 합성 값이다. 운영 전송 본문은 수집기가 실제로 검증한 원천 레코드로 만든다([examples/README.md](../examples/README.md)).
- Root structure: `{"version":2,"run":{...},"items":[...],"manifest":{...}}` (0–500 items per request; details in [INGEST_V2.md](INGEST_V2.md)).
- `kind`: `transaction | settlement | news | benefit | task | event | journal`.
- `external_id`: stable, unique per item within the same `kind`; **do not generate new IDs on each sync**.
- `title`: required string. `amount`: number, not a formatted currency string. `status`: `pending | done | active | archived`.
- `event_date` and `due_date`: `YYYY-MM-DD`, when supplied.
- Ingest currently upserts all supplied items, but **does not delete records omitted from subsequent batches**.
- Field updates: each item updates only the keys it sends; omitted optional fields (`description`, `amount`, `category`, `source`, `event_date`, `due_date`, `url`) keep their stored value, and an explicit `null` writes null. Omitted `currency`/`status` also keep the stored value (new rows get `KRW`/`active`). Earlier batch upserts wrote null for a key that only other items in the same batch sent; that no longer happens. See docs/INGEST_V2.md ⑦.
- If the stored row changed between the ingest checks and the write, the request fails with `409 {"code":"CONCURRENT_CHANGE"}`; resend the batch.
- Existing completed settlements and tasks are preserved against normal resync by a best-effort merge. **Concurrent ingest and user status changes can race.** Do not assume strict transactional safety yet.
- 화면 검사는 `npm run screens`가 합성 세션과 가짜 `/api/dashboard` 응답으로 `/`를 본다.
- The UI currently refreshes production data every 60 seconds.
- v2 규격: docs/INGEST_V2.md (`"version": 2` 본문, 같은 `POST /api/ingest`).
- 수신은 v2 전용이다(활성 dataset 모두 v2 확인 후 12단계에서 v1 제거, 2026-11-25). 새 수집기·새 dataset 의 첫 수신은 [DEPLOY.md](DEPLOY.md) (3) 배포 후 확인이 끝난 뒤에만 [INGEST_V2.md](INGEST_V2.md) ⑪ (3) 판정으로 확인한다.
- 별도 실행 보고 경로 `/api/sync-runs` 는 12단계에서 제거됐다(2026-11-25). 실행 기록은 v2 본문의 `run` 으로 항목과 함께 저장되므로 따로 보고하지 않는다.
- 같은 실행 키가 옛 `/api/sync-runs` 로 먼저 기록돼 있으면(기존 `commit_source` 'report' 행) v2 는 `409 RUN_ID_CONFLICT` 가 된다 — 새 `run_id` 를 쓴다([INGEST_V2.md](INGEST_V2.md) ⑤·⑪).

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
