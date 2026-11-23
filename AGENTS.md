# AGENTS

Personal Dashboard는 모바일 개인 대시보드(Next.js 15 + TypeScript + Supabase)입니다. 개발은 ai-orchestrator 엔진(`scripts/orch/`)이 계획 Issue를 스텝 단위로 Claude에게 구현시키는 방식입니다. **공개 저장소**입니다.

## 검수 기준 (Codex 독립 검수)

스텝 PR을 볼 때 다음을 확인하고, 문제는 파일·줄과 함께 적습니다.

1. **실데이터 노출 (차단)** — 실명·금액·가맹점·카드/승인번호·전화번호 등 실제 개인 데이터가 코드·테스트·문서·SUMMARY에 들어갔는지. 가짜임이 분명한 값만 허용.
2. **보안 (차단)** — RLS 우회, service role 키의 클라이언트 노출(`NEXT_PUBLIC_`·'use client' 파일), `/api/ingest` 토큰 검증 누락·약화, 로그인 없이 개인 데이터를 돌려주는 API, 입력 검증(Zod) 누락.
3. **CLAUDE.md 규칙** — 지시받은 스텝만 했는지, `.github/`·`scripts/orch/` 수정, 지시 없는 인증·DB 스키마 변경이 없는지.
4. **버그** — 동작 오류, 경계값, 비동기·에러 처리 누락, 타입 우회, 중복 수신(upsert·external_id) 처리.
5. **범위 밖 변경·테스트 누락** — 스텝과 상관없는 변경, 새 동작에 테스트 없음, `npm run typecheck`·`npm test`·`npm run build` 깨짐.

## 먼저 볼 파일

- [CLAUDE.md](./CLAUDE.md) — 구현 규칙
- [docs/PROJECT_PLAN.md](./docs/PROJECT_PLAN.md) — 목표·원칙·구조
- [docs/ORCH_MANUAL.md](./docs/ORCH_MANUAL.md) — 운영 방식
