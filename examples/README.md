# examples

두 파일은 **형식 확인용 합성 예시**다. 그대로 운영 `/api/ingest` 로 보내지 말 것(쓰기 경로다 — v1 은 `validate_only` 를 생략하면 저장됨).
운영에는 수집기가 실제로 검증한 원천 레코드로 본문을 만들어 보낸다.

| 파일 | 형식 | 언제 |
|---|---|---|
| [pickle-payload-v1.json](pickle-payload-v1.json) | v1 `{"items":[...]}` | 지금(8단계 전) 운영이 받는 형식 |
| [pickle-payload.json](pickle-payload.json) | v2 (`version:2`·`run`·`items`·`manifest`) — [docs/INGEST_V2.md](../docs/INGEST_V2.md) `example:success` 와 같음 | 8단계(운영 DB 반영) 뒤 |

합성 예시 형식 확인은 로컬에서 한다:

```sh
node --experimental-strip-types --test tests/examples.test.mjs
```

참고: v1 의 `validate_only:true` 는 저장은 하지 않지만 운영 DB 에서 기존 행·중복 후보를 조회한다(`lib/ingest-service.ts` 105~138행). 형식 확인 용도로 운영에 보내지 말고 위 로컬 테스트를 쓴다.
