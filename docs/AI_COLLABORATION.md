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

- Production ingest: `POST https://private-dashboard-ivory.vercel.app/api/ingest`
- Header: `Authorization: Bearer <PICKLE_INGEST_TOKEN>`
- Header: `Content-Type: application/json`
- Request body: `examples/pickle-payload.json`
- Root structure: `{"items":[...]}` (1–100 records per request).
- `kind`: `transaction | settlement | news | benefit | task | event | journal`.
- `external_id`: stable, unique per item within the same `kind`; **do not generate new IDs on each sync**.
- `title`: required string. `amount`: number, not a formatted currency string. `status`: `pending | done | active | archived`.
- `event_date` and `due_date`: `YYYY-MM-DD`, when supplied.
- Ingest currently upserts all supplied items, but **does not delete records omitted from subsequent batches**.
- Existing completed settlements and tasks are preserved against normal resync by a best-effort merge. **Concurrent ingest and user status changes can race.** Do not assume strict transactional safety yet.
- The `/demo` page uses fabricated, client-local records and **never calls the production ingest or update APIs**.
- The UI currently refreshes production data every 60 seconds.

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
