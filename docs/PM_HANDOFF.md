# PM 인수인계

_마지막 갱신: 2026-11-25 01시_

## 현재 상태
- 진행 단계 1~6 완료. 다음은 7단계(화면 코드 정리)다. 디자인은 사용자 요청으로 미뤘고, 11단계 '디자인 개선(나중)'으로 옮겼다.
- 6단계는 계획 다섯 개로 나눠 반영했다.
  - ① #23: 수집기 토큰 검사 공통화(`lib/collector-auth.ts`), 401·5xx 원인 로그(`lib/api-log.ts`, 값 없이 코드만).
  - ② #28: v2 규격(`docs/INGEST_V2.md`, `lib/ingest-v2.ts`), 수신 커밋 DB 함수(`20261124000000_ingest_commit.sql`).
  - ③ #32: `/api/ingest` v1·v2가 함수로만 저장(`lib/ingest-service.ts`). 메모는 원자적으로 갱신하고, 조회는 RPC 페이지로 하며, 원천 ID 공백을 정규화(`20261124000100_ingest_support.sql`). v1도 이제 행별로 "보낸 키만 갱신"한다.
  - ④ #37: `/api/items` 옛 형식 삭제, 상태 수정은 정산·할 일의 pending/done만. `/api/sync-runs` GET 삭제. 예시 v1·v2(`examples/`).
  - ⑤ #42: 일회성 API 4개 삭제. `tests/db/90`이 백필 마이그레이션 없이도 나머지가 동작하는지 확인한다.
- 엔진: 자동 모드(`ORCH_AUTO`)가 켜져 있다. 시작·감사 지적 반영·최종 반영·다음 계획 작성(`plan-next`)을 모두 자동으로 한다. Claude 사용량 한도에 걸리면 풀리는 시각까지 기다린다. 사람만 할 수 있는 일은 "사람 할 일 (자동 모드)" Issue(`orch:human`)에 쌓는다.

## 운영 상태 (중요)
- 운영 배포는 아직 옛 저장소 private_dashboard에 연결된 Vercel 프로젝트에서 된다. 6단계 변경은 운영에 들어가지 않았다.
- 피클AI는 v1으로 `/api/ingest`에 직접 POST한다. 2026-11-24에 토큰을 교체한 뒤 200을 확인했다.
- 운영 Supabase는 무료 플랜이라 일주일 쓰지 않으면 일시정지된다. 계정 전체에서 활성 프로젝트는 2개까지다(ai-orchestrator, 운영). 개발용 프로젝트는 일시정지 상태다.
- 2026-11-24 확인: 운영 DB에 `dashboard_backfill_batches` 표가 없었다. `BACKFILL_APPLY_ENABLED`는 없다. 피클AI는 일회성 4개 경로를 부르지 않는다.

## 결정한 것
- 공개 저장소다. 실데이터는 Supabase에만 둔다. AI는 운영 DB에 접근하지 않는다. 화면 구성은 유지하고 디자인은 바꿀 수 있다.
- **디자인(DIAGNOSIS 7-5)은 사용자가 요청할 때 한다.** 자동 모드는 11단계를 고르지 않는다. 7단계는 화면 모양을 바꾸지 않는 코드 정리만 한다.
- 5단계의 개발 DB는 CI Postgres로 대체했다(무료 한도 때문).
- 보호 경로(`.github/`, `scripts/orch/`) 변경은 PM이 브랜치 → PR로 올리고 사용자가 Merge한다.
- private_dashboard는 8단계(Vercel 새 저장소 연결) 전까지 지우지 않는다.
- 사람만 할 수 있는 일(운영 배포, 비밀값, Vercel·Supabase 콘솔, 피클AI 설정)은 자동 모드에서 끝났다고 가정하고, 사람 할 일 Issue에 적는다.

## 다음 할 일
1. 7단계(DIAGNOSIS (7)절 7-1~7-4, 7-6): 화면 테스트를 데모에서 떼기 → demo-dashboard 분리 → 데모 삭제 → 이름 정리. 화면 모양은 그대로 둔다(screens 검사 유지).
2. 8단계(배포 분리):
   - AI 몫: 개발계/운영계 설정 코드·문서, 배포 전 점검표.
   - 사람 몫: 운영 DB에 `20261124000000`·`20261124000100` 적용(백필 `20261112000200`은 빼도 됨, `tests/db/90`). 적용 전에 `supabase/README.md`의 대조 쿼리로 확인한다. Vercel Git 연결을 새 저장소로 옮기고 개발·운영 비밀값을 분리한다.
3. 9단계: 피클AI v2 전환(사람 몫은 피클AI 설정 변경). 10단계: private_dashboard 삭제(사람).
4. 정리(나중): 백필 마이그레이션·`tests/atomic-backfill.test.sql`과 `dashboard-qa.yml`의 백필 잡(`.github` 변경이라 PM PR).
