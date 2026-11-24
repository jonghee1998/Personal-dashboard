// Static text for the '구조' tab. Written from the code in app/api, lib, supabase,
// .env.example and .github/workflows. No real data, URLs or key values: names only.

export type ArchitectureSection={no:string;kicker:string;title:string};

export const architectureSections=[
 {no:'01',kicker:'목표 구조',title:'AI는 개발 쪽, 실데이터는 운영 쪽에만'},
 {no:'02',kicker:'요약',title:'수집기가 쓰고, 나는 폰으로 본다'},
 {no:'03',kicker:'아키텍처',title:'쓰기는 토큰, 읽기는 로그인 세션'},
 {no:'04',kicker:'배포·비밀값',title:'비밀 키는 Vercel 서버에만 둔다'},
 {no:'05',kicker:'데이터 흐름',title:'검증을 통과한 데이터만 저장된다'},
 {no:'06',kicker:'화면',title:'다섯 탭이 같은 조회 결과를 나눠 본다'},
 {no:'07',kicker:'API',title:'API 4개: 수집기 2개, 화면 2개'},
 {no:'08',kicker:'안전장치',title:'키·데이터·DB 접근을 따로 막는다'},
 {no:'09',kicker:'개발 방식',title:'계획→구현→검수→반영을 AI가 돈다'}
] as const satisfies readonly ArchitectureSection[];

/** Text for the target-structure diagram (01). Names only: no real domains, URLs or key values. */
export const targetDiagram={
 ariaLabel:'목표 구조: GitHub 저장소와 AI 팀(PM 계획·점검, 구현, 검수, CI)은 코드만 다루고 데이터가 없다. GitHub 에서 왼쪽 개발 영역의 Vercel 개발계(PR 미리보기, AI 테스트)와 Supabase 개발 DB(가짜 데이터만)로, 오른쪽 운영 영역의 Vercel 운영계(반영 10개마다 배포)와 Supabase 운영 DB(실데이터, 본인 행만 RLS)로 이어진다. 피클AI 는 토큰으로 운영계 POST /api/ingest 에 보내고, 내 폰은 로그인 후 운영계에서 조회한다. AI 는 운영계와 운영 DB 에 접근하지 않는다.',
 legend:'왼쪽 = AI가 만지는 개발 영역 · 진한 상자 = 실데이터(AI 접근 금지)',
 devLabel:'개발',
 opsLabel:'운영',
 github:['GitHub · AI 팀','코드만 · 데이터 없음'],
 team:['PM','구현','검수','CI'],
 devApp:['Vercel','개발계','PR 미리보기'],
 devDb:['Supabase','개발 DB','가짜 데이터만'],
 opsApp:['Vercel','운영계','반영 10개마다'],
 opsDb:['Supabase','운영 DB','실데이터 · RLS'],
 users:['피클AI','내 폰','토큰 · 로그인']
} as const;

export type TargetRow={area:string;now:string;target:string;phase:string};
/** Now → target. phase is the step number on the progress board, or '완료'. */
export const targetRows:readonly TargetRow[]=[
 {area:'저장소',now:'공개 저장소 하나',target:'코드만 · 데이터 없음',phase:'완료'},
 {area:'AI 팀',now:'PM·구현·검수·CI',target:'운영계·운영 DB 접근 없음',phase:'완료'},
 {area:'수신 API',now:'4개',target:'수신 1개 + 조회',phase:'6단계'},
 {area:'DB',now:'운영 1개',target:'개발 / 운영 분리',phase:'5단계'},
 {area:'배포',now:'옛 저장소 연결',target:'개발계 / 운영계',phase:'8단계'},
 {area:'테스트',now:'단위 + 화면',target:'개발 DB 연동 추가',phase:'5단계'},
 {area:'피클AI',now:'Issue + API',target:'API v2 만',phase:'9단계'},
 {area:'화면',now:'데모 섞임',target:'다섯 탭 정리',phase:'7단계'}
];

export const summaryLines=[
 '피클AI 수집기가 카드·뉴스·혜택·일정 데이터를 POST /api/ingest 로 보낸다.',
 '서버가 검증한 뒤 Supabase 의 dashboard_items 테이블 한 곳에 저장한다.',
 '나는 폰 브라우저로 로그인해 Vercel 에 배포된 이 대시보드에서 본다.',
 '화면은 60초마다 GET /api/dashboard 를 다시 읽어 갱신한다.'
] as const;

export type EnvRow={name:string;use:string;scope:'공개'|'서버 전용';note?:string};
/** Vercel environment variables, as read by process.env in app/ and lib/. */
export const vercelEnv:readonly EnvRow[]=[
 {name:'NEXT_PUBLIC_SUPABASE_URL',use:'Supabase 프로젝트 주소',scope:'공개'},
 {name:'NEXT_PUBLIC_SUPABASE_ANON_KEY',use:'로그인·RLS 범위 조회',scope:'공개'},
 {name:'SUPABASE_SERVICE_ROLE_KEY',use:'서버 쓰기(adminDb), RLS 우회',scope:'서버 전용'},
 {name:'PICKLE_INGEST_TOKEN',use:'수집기 Bearer 토큰 검증 (32자 이상)',scope:'서버 전용'},
 {name:'DASHBOARD_USER_ID',use:'수집 데이터 소유자 UUID',scope:'서버 전용'}
];

/** GitHub Actions secrets referenced by .github/workflows. None of them reach Supabase. */
export const githubSecrets:readonly {name:string;use:string}[]=[
 {name:'BOT_PAT',use:'오케스트레이터 푸시·PR'},
 {name:'CLAUDE_CODE_OAUTH_TOKEN',use:'Claude 구현·리뷰 작업'},
 {name:'CODEX_AUTH_KEY',use:'Codex 계획 리뷰·로그인'},
 {name:'NTFY_TOPIC',use:'진행 알림 전송'}
];

export const flowSteps=[
 {step:'1 수신',line1:'POST /api/ingest',line2:'Bearer 토큰 · 한 번에 최대 100건'},
 {step:'2 검증',line1:'Zod 스키마 · 무결성 규칙',line2:'중복·오래된 재전송이면 4xx 거절'},
 {step:'3 저장',line1:'dashboard_items upsert',line2:'키 user_id + kind + external_id'},
 {step:'4 화면 갱신',line1:'GET /api/dashboard',line2:'60초마다 자동 · ↻ 버튼으로 즉시'}
] as const;

export const screenRows=[
 {tab:'홈',shows:'이번 달 카드 지출, 오늘 할 일, 오늘의 뉴스'},
 {tab:'금융',shows:'카테고리·일별 지출, 정산, 거래 내역·메모, AI 구독료'},
 {tab:'뉴스',shows:'카테고리별 뉴스 브리핑'},
 {tab:'혜택',shows:'보유 포인트, 혜택 신청 현황'},
 {tab:'기록',shows:'캘린더: 일정·할 일·뉴스·포인트 내역'},
 {tab:'구조',shows:'이 화면 (정적, 데이터를 읽지 않음)'}
] as const;

export type ApiRow={path:string;methods:string;caller:string;auth:string};
/** Every app/api/**\/route.ts. tests/architecture-content.test.mjs compares this with the filesystem. */
export const apiRows:readonly ApiRow[]=[
 {path:'/api/ingest',methods:'POST',caller:'피클AI 수집기',auth:'Bearer 토큰'},
 {path:'/api/sync-runs',methods:'POST',caller:'POST 수집기(실행 보고, 9단계까지 호환)',auth:'Bearer 토큰'},
 {path:'/api/dashboard',methods:'GET',caller:'대시보드 화면',auth:'로그인 세션'},
 {path:'/api/items',methods:'PATCH · POST · DELETE',caller:'대시보드 화면 (상태·메모·할 일)',auth:'로그인 세션'}
];

export const safeguardRows=[
 {name:'RLS',desc:'dashboard_items·sync_runs 는 본인 행만 조회, 화면 쓰기는 items 수정만. 백필 배치 테이블은 service_role 전용.'},
 {name:'service role 키',desc:'lib/supabase-server.ts 의 adminDb 에서만 사용. 브라우저(lib/supabase.ts)는 anon 키만.'},
 {name:'ingest 토큰',desc:'수집기 API 2개(/api/ingest, /api/sync-runs)가 lib/collector-auth.ts 한 곳에서 검사: 32자 미만 거부, timingSafeEqual 비교. 틀리면 401.'},
 {name:'공개 저장소',desc:'코드·테스트·문서에 실데이터 금지. CI 가 추가된 줄을 개인정보 검사.'},
 {name:'AI 개발',desc:'운영 DB 접근 금지. 테스트는 가짜 데이터·모의 객체로만.'}
] as const;

export const devLines=[
 '계획: 이슈로 올린 목표를 오케스트레이터가 스텝으로 나눈다.',
 '구현: Claude 가 스텝 하나씩 코드를 쓰고 typecheck·test·build 를 돌린다.',
 '검수: CI(개인정보 검사 포함)와 AI 리뷰가 결과를 확인한다.',
 '반영: 통과한 변경만 main 에 합친다. 진행 상황은 ai-orchestrator 상황판에서 본다.'
] as const;
