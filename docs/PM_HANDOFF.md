# PM 인수인계

_마지막 갱신: 2026-11-24 16시_

## 현재 상태
- 진행 단계 1~4 완료. 5단계 전반 완료: #15 → 최종 PR #20 반영(14:52). 반영한 것: SQL 테스트 괄호, 마이그레이션 기준선(`supabase/migrations/`), 가짜 시드, DB 테스트 6개(CI db 잡), API 인증 실제 호출 테스트, `ingest_gate.py` 주소 환경변수화(`DASHBOARD_INGEST_BASE_URL`).
- main의 Dashboard data QA가 #20 이후 다시 통과한다.
- 엔진 수정 #21(ai-orchestrator #324와 동일): orch/* PR이 닫히거나 Merge되면 `pull_request_target`으로 바로 완료·취소 처리하고, 순찰 시간을 7·27·47분으로 옮겼다. #20 Merge 2초 뒤 #15가 완료돼 동작을 확인했다.
- cron 원인: 설정 문제가 아니라 GitHub가 정기 실행을 자주 건너뛴다. 완료 처리를 순찰에만 맡겨서 생긴 문제였고, 위 수정으로 해결했다.

## 2026-11-24 운영 장애 (해결)
- 피클AI 전송 500 `Status lookup failed`: 운영 Supabase(JH personal dashboard)가 무료 플랜 비활성으로 일시정지돼 있었다. 무료 활성 2개 한도 때문에 Restore가 막혀서, 개발용 프로젝트(personal-dashboard-dev 조직)를 일시정지한 뒤 운영 프로젝트를 복구했다.
- 그다음 401 `Unauthorized`: 원인은 확인하지 못했다. 토큰을 새로 맞추고(피클AI가 생성 → Vercel `PICKLE_INGEST_TOKEN` 교체 → Redeploy) 200을 확인했다.
- 피클AI는 `/api/ingest`에 직접 POST한다(`ingest_gate.py`는 쓰지 않음).
- 운영 Vercel 프로젝트는 아직 옛 저장소 private_dashboard에 Git으로 연결돼 있다. 새 저장소에는 배포 기록이 없다.

## 결정한 것
- 공개 저장소, 실데이터는 Supabase 에만. AI 는 운영 DB 접근 금지. 화면 구성 유지, 디자인 변경 가능.
- 새 프로젝트 표준 절차는 ai-orchestrator docs/NEW_PROJECT.md 를 따른다.
- 스위치는 상황판에서 모든 프로젝트에 일괄 적용.
- 사용자에게 무언가 요청할 때는 항상 링크를 함께 준다.
- 보호 경로(`.github/`, `scripts/orch/`) 변경은 PM이 브랜치 → PR로 올리고 사용자가 Merge한다(main 직접 push 금지).
- private_dashboard는 8단계(Vercel 새 저장소 연결) 전까지 지우지 않는다.

## 다음 할 일
1. 5단계 완료(2026-11-24 사용자 결정: 개발 DB는 CI Postgres로 대체, 진짜 Supabase 확인은 8단계). 6단계 ① 계획 #23(수집기 인증 공통화 + 실패 원인 로그) 감사 → 승인 → 진행.
2. 6단계 ② 이후: 6-2(수신 트랜잭션 함수·v2 규격)+6-4, 6-6(/api/items), 6-5(일회성 API 정리, 사용자 운영 DB 확인 선행), 6-7(예시 페이로드)로 나눠 계획한다.
3. 운영 Supabase가 다시 일시정지되지 않는지 확인한다. 무료 플랜은 요청이 없으면 일주일 뒤 멈춘다.
4. 6·7단계는 DIAGNOSIS.md (7)절 할 일 표대로 계획한다(계획 작성 체크리스트 준수). 9단계 전까지 v1 수신 호환을 유지한다.
5. 8단계: Vercel Git 연결을 새 저장소로 바꾼다. 새 main으로 운영 코드가 바뀌므로 계획 → 감사 → 승인을 거친다.
