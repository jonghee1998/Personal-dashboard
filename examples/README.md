# examples

이 파일은 **형식 확인용 합성 예시**다. 그대로 운영 `/api/ingest` 로 보내지 말 것(쓰기 경로다).
운영에는 수집기가 실제로 검증한 원천 레코드로 본문을 만들어 보낸다.

| 파일 | 형식 |
|---|---|
| [pickle-payload.json](pickle-payload.json) | v2 (`version:2`·`run`·`items`·`manifest`) — [docs/INGEST_V2.md](../docs/INGEST_V2.md) `example:success` 와 같음 |

합성 예시 형식 확인은 로컬에서 한다:

```sh
node --experimental-strip-types --test tests/examples.test.mjs
```
