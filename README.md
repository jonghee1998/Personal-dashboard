# Personal Dashboard

모바일 다크모드 개인 대시보드. 개발은 [ai-orchestrator](https://github.com/jonghee1998/ai-orchestrator) 엔진(Claude PM·구현, Codex 검수)으로 하고, 피클AI가 수집한 데이터는 API로만 받아 Supabase에 저장합니다.

> **공개 저장소입니다.** 실명·금액·가맹점·카드/승인번호 등 실데이터를 코드·문서·Issue·PR에 절대 쓰지 마세요. 계획은 [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md), 인수인계는 [docs/PM_HANDOFF.md](docs/PM_HANDOFF.md).

## 기능
- 홈: 카드 지출, 미정산, 포인트, 할 일, 뉴스
- 금융: 카테고리별 카드 지출 분석, 정산 N분의 1, 완료/백데이터 및 복원
- 뉴스, 혜택/체험단, 일정/일일기록
- 로그인: Supabase Auth 이메일/비밀번호
- 사용자 변경: `PATCH /api/items` (Supabase 세션 필수)
- 피클AI 쓰기: `POST /api/ingest` (전용 Bearer 토큰, Zod 유효성 검사)
- 클라이언트 데이터 갱신: 60초마다 재조회

## 설치
1. Supabase에서 프로젝트 생성 → DB 스키마 적용 ([supabase/README.md](supabase/README.md))
   - 빈 개발 DB: `supabase/migrations/` 의 파일을 이름순으로 전부 적용
   - 기존 운영 DB: 적용 상태 미확인 — 운영자가 `supabase/README.md` 의 대조 절차로 판단한 뒤 필요한 것만 적용
2. Supabase Authentication > Users에서 본인 로그인 계정 생성; UUID를 복사
3. Vercel에 이 GitHub 저장소를 import (Framework: Next.js)
4. Vercel Environment Variables에 `.env.example`의 5개 항목 설정
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Project Settings에서 확인
   - `SUPABASE_SERVICE_ROLE_KEY`: **서버 비밀키**, 공개/커밋 절대 금지
   - `DASHBOARD_USER_ID`: 위 로그인 사용자 UUID
   - `PICKLE_INGEST_TOKEN`: 랜덤 32자 이상의 비밀 문자열
5. Deploy → 생성된 https://...vercel.app 주소에서 로그인
6. 피클AI에 URL + 전용 ingest token + `examples/pickle-payload.json` 규격 전달 (비밀키는 공개 Issue에 올리지 않기)

## 피클AI API

```http
POST /api/ingest
Authorization: Bearer <PICKLE_INGEST_TOKEN>
Content-Type: application/json
```

Body: `examples/pickle-payload.json` 참고. `items`는 1~100개 배열. `kind`는 transaction / settlement / news / benefit / task / event / journal. `external_id`는 **종류별로 일관된 고유 ID**. 동일 ID 재전송 시 upsert. 모든 데이터는 설정된 `DASHBOARD_USER_ID`로 귀속.

포인트는 `kind:"benefit", category:"points"`, 지출은 `kind:"transaction", amount:양수`, 정산은 `kind:"settlement", amount:받을 금액`으로 표준화.

**중요:** 피클AI가 과거 정산/할 일 상태를 재전송해도 기존 완료 상태를 되도록 유지하는 병합 코드는 들어 있지만, 동시 쓰기에서 원자성이 보장되는 상태는 아닙니다. 운영 전 SQL RPC 트랜잭션 개선이 필요합니다.

**보안:** Private repo여도 배포 URL은 공개될 수 있습니다. API 토큰 및 service role key는 Vercel 서버 환경변수에만 저장하고 피클AI에는 ingest token만 전달하세요. 이 시스템은 은행 자격증명 수집용이 아닙니다.

## 개발 상태
앱 코드의 초기 구현은 GitHub에 업로드되었으나, **Vercel/Supabase 실배포 및 빌드·런타임 통합 테스트는 아직 진행되지 않았습니다.** 실제 금융정보 입력은 배포·로그인·API 테스트 후 시작하세요.
