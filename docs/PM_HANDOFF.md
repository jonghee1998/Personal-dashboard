# PM 인수인계

_마지막 갱신: 2026-11-24 14시_

## 현재 상태
- 진행 단계 1~4 완료(이사, AI 팀 설치, 구조 화면 #2·#8, 코드 진단 #11 → docs/DIAGNOSIS.md). 5단계(개발 DB) 시작 전.
- 2026-11-24: 진단에서 나온 개인 흔적(운영 주소, 실제 같은 금액·건수, 지명)을 가짜 값으로 바꾸고 main 기록을 새로 만듦(force push, 사용자 승인). 옛 브랜치는 cleanup-branches 로 정리 중.
- 상황판 구조 탭은 이 저장소 docs/architecture.json 을 읽음(목적: 피클AI가 모은 내 지출·정산·뉴스·일정을 폰 하나로 보기).
- 알려진 문제: 이 저장소에서 orchestrator 정기 실행(cron)이 한 번도 안 돎 → #2 가 수동 반영 뒤에도 '반영 승인 대기'로 남음. 수동 실행으로 정리, cron 등록 여부 확인 필요.
- 계획 감사(Codex)가 정규화된 계획의 model:null 을 오탐함 → ai-orchestrator plan-review.mjs 에서 null 제거 후 보여 주도록 고칠 것.

## 결정한 것
- 공개 저장소, 실데이터는 Supabase 에만. AI 는 운영 DB 접근 금지. 화면 구성 유지, 디자인 변경 가능.
- 새 프로젝트 표준 절차는 ai-orchestrator docs/NEW_PROJECT.md 를 따른다(기본 환경 → 진행 단계 → 구조 확인 → 작업).
- 스위치는 상황판에서 모든 프로젝트에 일괄 적용.
- 사용자에게 무언가 요청할 때는 항상 링크를 함께 준다.

## 다음 할 일
1. 5단계: 사용자 개발용 Supabase 생성(https://supabase.com/dashboard/new) → PM 계획(진단 5-1~5-7: SQL 테스트 괄호, 마이그레이션 기준선, 개발 DB 적용, 가짜 시드, DB 연동·API 인증 테스트, 남은 주소 환경변수화).
2. 6·7단계는 DIAGNOSIS.md (7)절 할 일 표대로 계획.
3. 9단계 전까지 v1 수신 호환 유지(DIAGNOSIS.md 끝 표).
