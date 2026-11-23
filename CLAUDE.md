# CLAUDE.md

이 저장소는 orchestrator가 Claude에게 스텝 단위로 일을 맡깁니다. 지시(prompt)에 적힌 작업 규칙이 이 파일보다 우선합니다.

- 지시받은 스텝만 구현합니다. 범위 밖 리팩터링은 하지 않습니다.
- 코드를 바꾸면 `npm run typecheck`와 `npm test`로 확인하고, 새 동작에는 테스트를 추가합니다 (CI는 `npm run build`와 개인정보 검사도 실행합니다).
- `.github/`와 `scripts/orch/`는 수정하지 않습니다. 수정하면 오케스트레이터가 푸시를 거부합니다.
- git push, 브랜치 생성, PR 생성은 하지 않습니다.
- 끝나면 `.orch/SUMMARY.md`에 변경 요약과 완료 기준 확인 결과를 적습니다.
- 진행할 수 없으면 `.orch/BLOCKED.md`에 이유를 적고 멈춥니다.

## 이 저장소 추가 규칙 (공개 저장소 · 개인 대시보드)

- 스택: Next.js 15 + TypeScript + Supabase(`lib/supabase*.ts`, `supabase/*.sql`) + Python 검증 스크립트(`scripts/*.py`, 표준 라이브러리만).
- **실데이터 금지**: 실명, 금액, 가맹점, 카드·승인번호, 전화번호, 계좌 등 실제 개인 데이터를 코드·테스트·문서·커밋 메시지·`.orch/SUMMARY.md`·로그 출력에 쓰지 않습니다. 이 저장소와 Actions 로그는 공개입니다. 예시·테스트는 `친구A`·`합성가맹점A`처럼 누가 봐도 가짜인 값만 씁니다.
- **운영 DB 접근 금지**: 운영 Supabase URL·키를 찾거나 쓰지 않습니다. DB가 필요한 테스트는 가짜 데이터·모의 객체 또는 지시에 명시된 개발용 DB로만 합니다.
- `SUPABASE_SERVICE_ROLE_KEY`는 서버 코드에서만 씁니다(클라이언트 컴포넌트·`NEXT_PUBLIC_` 금지). RLS 정책과 인증(`lib/supabase*.ts`, `app/login`, `app/api/*`의 인증 부분)은 지시에 명시된 경우에만 바꿉니다.
- 화면 구성(홈·금융·뉴스·혜택·기록 탭)은 유지합니다. 디자인은 지시가 있으면 바꿀 수 있습니다. 데모 기능을 새로 늘리지 않습니다.
- 운영 방식은 [docs/ORCH_MANUAL.md](docs/ORCH_MANUAL.md)를 따릅니다.
