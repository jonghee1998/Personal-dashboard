# PM 인수인계

_마지막 갱신: 2026-11-23_

## 현재 상태
- private_dashboard(비공개)에서 코드만 기록 없이 이 저장소(공개)로 이사함.
- 실데이터가 든 문서 12개(`docs/ISSUE_*`, `docs/PROMPT_*`) 제외, `tests/test_report_invariants.py`의 실명은 친구A·B로 교체.
- 타입 검사·단위 테스트 80개 통과. 빌드·연동·화면 테스트는 없음.
- 프로젝트 계획: `docs/PROJECT_PLAN.md`, 상황판용 체크리스트: `docs/roadmap.json`.

## 결정한 것
- 저장소 이름 Personal-dashboard, 공개. 실데이터는 Supabase에만 둠.
- 기존 대시보드 화면 구성은 유지, 디자인은 바뀔 수 있음. 나머지 개발은 Claude PM이 엔진으로 진행.
- 기존 private_dashboard는 보관하지 않음. 이사 확인 후 사용자가 삭제.
- AI는 운영 DB에 접근하지 않고 개발용 Supabase로만 테스트(개발 DB 생성은 사용자 확인 필요).
- 상황판에는 대시보드 데이터를 넣지 않고, 홈에 에이전트별 진행 작업만 표시.

## 다음 할 일
1. 사용자: 상황판 `ORCH_REPOS`에 `jonghee1998/personal-dashboard` 추가, `ORCH_GITHUB_TOKEN`에 이 저장소 권한 추가.
2. PM: 엔진 설치(2단계) — scripts/orch, 워크플로, CLAUDE.md·AGENTS.md, CI 개인정보 패턴 검사.
3. 사용자: Secrets 입력(CLAUDE_CODE_OAUTH_TOKEN, BOT_PAT, NTFY_TOPIC), Codex 리뷰 켜기.
4. ai-orchestrator: 상황판 홈에 '에이전트 → 프로젝트 → 작업' 한 줄 표시 계획.
5. 엔진 첫 작업: 코드 진단 보고서(6.1).
