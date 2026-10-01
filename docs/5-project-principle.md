# Coupang AI Detail Maker - 프로젝트 구조 설계 원칙 (v0.1.13 초안)

## 1. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서 | Coupang AI Detail Maker 프로젝트 구조 설계 원칙 |
| 버전 | v0.1.13 (초안) |
| 작성일 | 2026-09-30 |
| 작성자 | hyunboee (Claude 작성) |
| 기준 도메인 정의서 버전 | v0.3.13 (`docs/1-domain-definition.md`) |
| 기준 PRD 버전 | v0.3.12 (`docs/2-PRD.md`) |
| 참고 | `docs/3-user-scenario.md` v0.1.11, `docs/4-wireframes.md` v0.1.11, `CLAUDE.md`(오버엔지니어링 금지, 단순함 우선) |
| 범위 | 레이어·의존 방향, 네이밍, 테스트, 설정·보안·운영, 디렉토리 구조. 기능 명세는 PRD를 따른다 |

**표기 규약**
- 원칙 ID: `PP`(공통), `LY`(레이어), `NM`(네이밍), `QA`(테스트), `OP`(설정·보안·운영). 근거는 PRD·도메인 ID(FR, NFR, BR, P, D, AC, PRD-V)로 단다.
- `(S)`: MVP 직후 단계에서 추가. `신규`: 문서에 없는 라이브러리로 이 문서가 새로 권하는 것.
- `확인 필요`: 문서 근거가 부족해 결정이 필요한 항목. 번호(C-n)는 8.2절과 대응한다.

### 문서 변경 이력

> 새 행은 표 맨 위에 추가한다.
> 기준 문서(도메인 정의서, PRD)가 갱신되면 이 문서도 갱신하고 기준 버전을 기록한다.

| 버전 | 일자 | 변경자 | 기준 도메인 | 기준 PRD | 변경내용 |
|---|---|---|---|---|---|
| v0.1.13 | 2026-10-01 | hyunboee (Claude 작성) | v0.3.13 | v0.3.12 | 의존 예외(require-auth)·일일 상한 안내 방식 정리: LY-06, 3.1 허용/금지 의존 표(middleware 행) |
| v0.1.12 | 2026-10-01 | hyunboee (Claude 작성) | v0.3.12 | v0.3.11 | 백엔드 구현 기준 최신화: LY-05(uuid 검사 위치, 정적 서빙 미구현 표시), LY-06(확장 토큰 허용 라우트 미구현), 6.1(`NODE_ENV`·`PORT` 기본값, S3 필수 변수, 구현된 상수 보충), OP-12(SIGINT), 7.3 디렉토리(package.json 스크립트, routes·lib·test 목록, 정적 서빙 미구현 표시) |
| v0.1.11 | 2026-10-01 | hyunboee (Claude 작성) | v0.3.11 | v0.3.10 | 개발용 CORS·Swagger UI 반영: LY-05, 3.5(쓰지 않음 행), 6.1 `FRONTEND_ORIGIN` 행, OP-04, 7.3 디렉토리(middleware), 8.2 C-3 |
| v0.1.10 | 2026-10-01 | hyunboee (Claude 작성) | v0.3.10 | v0.3.9 | 백엔드 구현 [가정] 반영: LY-05(일반 리밋은 `requireAuth` 뒤, signup·logout 리밋 없음), LY-06(`assertEligible(userId, db)`), 3.5(prettier 미설치), 4.2(코드 사용 확정), 6.1(환경변수·dev 기본값·스토리지 드라이버), 6.1 아래 상수 문단, OP-06, OP-07(`src`는 `asset:{uuid}`만), OP-12(본문), 8.2 C-6(해소) |
| v0.1.9 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.9 | v0.3.8 | DB-01~03 구현 후속 정합화: 6.1 환경변수(`DATABASE_URL` → `DB_CONN_STRING`, `.env.test`, 작업 주기 선택 키 2개), 5.2 비밀값 스캔 행(P2, `postgresql://`) |
| v0.1.8 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.8 | v0.3.7 | QA-02: 테스트 DB 위치를 로컬 Docker에서 로컬 설치 PostgreSQL 17 서버로 변경 |
| v0.1.7 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.8 | v0.3.7 | 권장안 반영: 자격 검사 서비스 내 판정, 퍼블리시 TX 잔액 선검사, PG Should 근거. LY-05, LY-06, 허용/금지 의존 표(middleware), 4.3 용어(사용 자격), 7.3 디렉토리(middleware, services), 8.1 체크리스트, 8.2 C-5·C-9 |
| v0.1.6 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.7 | v0.3.6 | 문서 간 정합성 재점검 반영: PP-01, QA-05(2일 → MVP 일정), LY-06(자격 검사 대상 8종 → 9종, 폼 저장 추가, DEC-05) |
| v0.1.5 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.6 | v0.3.5 | 5.x 테스트 배치 문단을 단계 P1/P2 구조에 맞춤(테스트 우선순위 P0~P2와 단계 P1·P2 용어 구분) |
| v0.1.4 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.6 | v0.3.5 | MVP 일정·범위 2단계(P1 2일 핵심 슬라이스, P2 MVP 완성) 재조정(Claude 위임 결정). 기준 문서 버전 갱신만(1장 참고 문서 버전 포함, 원칙 본문 변경 없음) |
| v0.1.3 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.5 | v0.3.4 | 권장안 반영: 폼 저장 version+1, 최종 HTML 편집 속성 제거. OP-07 |
| v0.1.2 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.4 | v0.3.3 | 미결 결정 DEC-01~10 반영(Claude 위임 결정): LY-05(cors 제거), 3.5(신규 라이브러리 6개 승인, cors), 4.2(오류 코드 확정, 판정 순서), 4.3(editId), 6.1(`FRONTEND_ORIGIN`, R2 접속 값), OP-04(동일 출처), OP-07(`data-edit-id`), OP-11(단일 출처 배포), 7.2·7.3 디렉토리(cors 제거, 정적 서빙), 8.2 C-1·C-2·C-3·C-4·C-9(해소) |
| v0.1.1 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.3 | v0.3.2 | 문서 간 정합성 점검 반영: LY-06, 5.2 P0(PUBLISHED 재요청), 8.2 C-5, C-8, C-10(해소 표시), C-2(PRD 8장 참조), C-1, C-3, C-9(교차 참조) |
| v0.1 | 2026-09-30 | hyunboee (Claude 작성) | v0.3.2 | v0.3.1 | 최초 작성. 공통·레이어·네이밍·테스트·운영 원칙, 디렉토리 구조, 리뷰 체크리스트, 확인 필요 목록 |

---

## 2. 최상위 공통 원칙 (모든 스택 공통)

| ID | 원칙 | 근거 |
|---|---|---|
| PP-01 | **단순함 우선.** 1인·MVP 규모에 맞는 가장 짧은 코드를 쓴다. 인터페이스 하나에 구현 하나, DI 컨테이너, 레포지토리 계층, 제네릭 베이스 클래스, "나중을 위한" 설정·폴더를 만들지 않는다 | CLAUDE.md, G-1 |
| PP-02 | **서버가 진실의 원천.** 사용 자격, 잔액, 사용 한도 카운트, version, 상태 전이, 워터마크는 서버에서만 판정·생성한다. 프론트의 버튼 비활성·남은 횟수 표시는 UX 힌트일 뿐이며 서버는 항상 다시 검사한다 | BR-03, BR-10, BR-47, BR-48, BR-51, FR-06 |
| PP-03 | **원자성은 DB에서.** 동시성·멱등·비음수는 앱 코드의 "먼저 읽고 판단"이 아니라 DB 제약(UNIQUE, 부분 유니크, CHECK), 조건부 원자 UPDATE, `FOR UPDATE` TX로 강제한다 | P-5, BR-12~15, BR-47, FR-21 |
| PP-04 | **비밀값은 백엔드 환경변수에만.** LLM·DB·스토리지·JWT 키는 프론트 번들과 확장 패키지에 들어가지 않는다 | P-2, NFR-07, BR-63, BR-71 |
| PP-05 | **결제 전 완성본 유출 금지.** 응답은 화이트리스트 매퍼로만 만든다. 퍼블리시 전 응답에 원본 키·URL, draftHtml, finalHtml, 공개 URL을 넣지 않는다 | BR-32, BR-50, BR-53, NFR-08, PRD-V-4 |
| PP-06 | **LLM 대기 중 DB 자원을 잡지 않는다.** 선점(짧은 UPDATE) → TX 밖에서 LLM 호출 → 결과 반영(짧은 TX, version 재확인) 순서를 지킨다 | P-7, NFR-05, FR-34 |
| PP-07 | **도메인 용어 일관성.** 코드·DB·API·UI 문구는 용어집의 단어를 4.3절 매핑표대로 쓴다. 동의어를 새로 만들지 않는다 | 도메인 2장 |
| PP-08 | **LLM은 Role로만 호출.** 서비스 코드는 `callRole('LIGHT'\|'MAIN', input)`만 알고 Provider·모델 ID를 모른다 | P-4, BR-70, FR-27 |
| PP-09 | **수치는 한 곳.** D 항목 수치(상한, 만료, 동시성)는 백엔드 `config.js` 상수 한 곳에 두고 D-ID 주석을 단다. 코드 곳곳에 숫자를 흩뿌리지 않는다 | 도메인 표기 규약, D-5·20·27~30 |
| PP-10 | **S·C 기능은 미리 만들지 않는다.** 폴더·테이블·라우트는 그 기능을 구현할 때 추가한다. 단 PRD가 스키마 선반영을 명시한 것(AI 수정 카운트 컬럼, 원장 source 컬럼)은 둔다 | PRD 4.2 |
| PP-11 | **규칙 ID로 추적.** 규칙을 강제하는 코드 줄과 그 테스트에 BR/FR ID를 남긴다(예: `// BR-13`) | 도메인 표기 규약 |

---

## 3. 의존성 / 레이어 원칙

### 3.1 백엔드 레이어

```
요청 → middleware → routes → services → db / llm / lib
```

| ID | 원칙 | 근거 |
|---|---|---|
| LY-01 | 레이어는 3단(routes → services → db)만 둔다. routes는 입력 검증·서비스 호출·HTTP 응답만, services는 도메인 규칙·SQL·TX를 가진다. 별도 repository/DAO 계층은 두지 않는다(SQL은 서비스 안에 파라미터 바인딩으로 직접 쓴다) | PRD 7.2, PP-01 |
| LY-02 | services는 `req`/`res`를 모른다. 평범한 인자(userId, projectId, body)를 받고 평범한 객체를 돌려주며, 실패는 `AppError(status, code)`를 던진다 | - |
| LY-03 | TX는 `db.js`의 `withTx(fn)` 하나로만 연다. TX에 참여해야 하는 함수는 `client`를 인자로 받는다. `withTx` 안에서 LLM·크롤링·스토리지 호출 금지 | P-5, P-7, PRD 7.2 |
| LY-04 | LLM 어댑터는 `llm/index.js` 하나다. Role 매핑, 세마포어·대기열, 계정 일일 상한, 사용량 로그를 모두 이 안에서 처리한다. 서비스는 이 모듈의 `callRole`만 import한다 | FR-27~29, NFR-03, BR-70 |
| LY-05 | 미들웨어 순서: `cors`(`FRONTEND_ORIGIN` 하나만 허용, 맨 앞) → `requestLog` → `express.json` → (auth 라우터: `cookieParser`, Origin 검사, 로그인·refresh 전용 리밋) → uuid 검사(`/api/projects/:id`가 uuid 형식이 아니면 404, 인증보다 먼저) → `requireAuth` → `rateLimit`(일반, 사용자당이라 `requireAuth` 뒤. signup·logout은 리밋 없음) → 라우트 핸들러 → `errorHandler`(마지막). `GET /healthz`와 개발용 `/api-docs`는 `requestLog` 앞에 둔다(로그·인증 없음). 자격 검사는 미들웨어가 아니다(LY-06). 운영은 동일 출처라 `cors`는 실질 영향이 없다. `NODE_ENV`가 production이 아닐 때만 `/api-docs`(Swagger UI)와 `/api-docs/swagger.yaml`을 등록한다(인증 없음). `/api` 밖 경로의 `frontend/dist` 정적 서빙과 SPA 폴백(OP-11)은 아직 구현되지 않았다(OPS-01) | FR-05, FR-06, NFR-04, NFR-09 |
| LY-06 | `requireAuth`는 인증만(DB 조회 없음, `services/auth`의 `verifyAccessToken`만 import하는 의존 예외, 3.1 의존 표), 자격 판정은 `services/eligibility.js`의 `assertEligible(userId, db)` 한 함수(DB 조회형, 퍼블리시 TX 안에서는 같은 client를 넘겨 재사용)로 두고 자격 검사 대상 API 9종에서만 호출한다. 프로젝트 대상 API는 서비스가 프로젝트를 조회한 직후 소유(404) → PUBLISHED(409, 퍼블리시 재요청은 기존 결과 반환, BR-13) → 403 → 402 → 409(version·진행 중 작업) 순으로 확인하고(퍼블리시는 TX 안에서 같은 순서), 프로젝트가 아직 없는 `POST /api/projects`만 라우트에서 호출한다(BR-10, FR-06). 확장 토큰(`typ=ext`)은 기본 거절하고 `GET /final`, `POST /publish-report` 두 라우트에서만 허용한다(현재 구현은 거절만, 허용은 BE-20) | FR-05, FR-06, FR-24, P-3 |
| LY-07 | 주기 작업(선점 만료 복원, 만료 refresh 행 삭제, 원장 대사)은 `jobs/`에서 `setInterval`로 돌린다. 쿼리는 조건부·멱등이어서 PM2 2프로세스가 동시에 돌아도 안전해야 한다 | FR-35, NFR-14, PRD 7.2 |

**허용/금지 의존 방향**

| 모듈 | 허용 | 금지 |
|---|---|---|
| routes | middleware, services, lib | db, llm 직접 호출, SQL |
| services | db, llm, lib, 다른 service(순환 금지) | express 객체(req/res) |
| llm | db(사용량 로그·상한 집계), config | services, routes |
| middleware | lib, config | services의 도메인 로직. 예외: require-auth는 services/auth의 verifyAccessToken만 import한다(DB 미사용 순수 함수, 토큰 서명·검증 로직을 한 곳에 두기 위함) |
| lib (html, storage, crawler, errors) | config | db, services, routes |
| jobs, scripts | services, db | routes |
| config | 없음(`process.env`만) | 모든 모듈 |

### 3.2 프론트엔드 레이어

```
pages → components → hooks(TanStack Query) → api(client) 
                ↘ stores(Zustand: UI 상태 + accessToken)
```

| ID | 원칙 | 근거 |
|---|---|---|
| LY-08 | 서버 데이터(프로젝트, 프리뷰, 잔액, 최종 HTML)는 TanStack Query에만 둔다. Zustand에는 UI 상태(선택 blockId, 모달, 토스트)와 인증 슬라이스(`accessToken`)만 둔다 | PRD 7.1, PRD 5.8 |
| LY-09 | 컴포넌트는 `fetch`를 직접 부르지 않는다. 모든 요청은 `api/client.ts`를 거친다. client가 Bearer 헤더, 401 `TOKEN_EXPIRED` 갱신 단일화(동시 요청은 같은 Promise 대기), 1회 재시도, 갱신 실패 시 스토어·캐시 초기화를 전담한다 | FR-40 |
| LY-10 | 오류 반응은 한 곳에서: 503은 QueryClient 재시도(`Retry-After`), 409는 해당 프로젝트 쿼리 무효화, 402·403은 `me` 기반 배너. 화면마다 따로 구현하지 않는다 | PRD 7.1, WF 5.2 |
| LY-11 | Access Token은 메모리(Zustand)에만. localStorage·sessionStorage·URL 금지 | PRD 5.8, NFR-09 |
| LY-12 | 프리뷰는 `sandbox` iframe(`allow-scripts` 없음)의 `srcdoc`으로만 렌더링한다. 서버 HTML을 `dangerouslySetInnerHTML`로 넣지 않는다 | FR-16, NFR-10 |
| LY-13 | 정적 랜딩(`/`)은 React를 쓰지 않는 HTML/CSS다. SPA 코드를 import하지 않는다 | FR-31, P-1 |

### 3.3 확장 프로그램 (S)

| ID | 원칙 | 근거 |
|---|---|---|
| LY-14 | 확장은 조회·주입·결과 보고만 한다. 과금·생성·편집 로직과 비밀값을 두지 않는다 | P-8, BR-63, BR-64 |
| LY-15 | 빌드 도구·프레임워크 없이 plain JS 파일 3개(manifest, service worker, content script). 서버 코드·프론트 코드를 공유 import하지 않는다 | PP-01 |
| LY-16 | 확장 토큰은 `chrome.storage.session`(브라우저 종료 시 삭제)에만 둔다. `host_permissions`는 WING 상품등록 페이지와 API 도메인만, `externally_connectable`은 프론트 도메인만 | BR-60, FR-24, FR-25 |

### 3.4 외부 패키지 추가 기준

| ID | 원칙 |
|---|---|
| LY-17 | 신규 6개(3.5절 `신규`)는 승인됨(2026-09-30 Claude 위임 결정). 추가 전 순서: 표준 라이브러리 → 플랫폼 기능(Node 내장 `fetch`·`crypto`·`node:test`·`--env-file`, 브라우저 `navigator.clipboard`) → 이미 있는 의존성 → 몇 줄의 직접 구현 → 그래도 안 되면 추가. 추가하면 이 문서 3.5 표에 한 줄 이유와 함께 기록한다 |
| LY-18 | 보안 경계(HTML 정제, 파일 업로드 파싱)는 직접 구현하지 않고 검증된 라이브러리를 쓴다. 반대로 요청 ID·JSON 로그처럼 10줄 이내로 되는 것은 직접 쓴다 |

### 3.5 의존성 목록

| 영역 | 패키지 | 출처 |
|---|---|---|
| 백엔드 | `express`, `pg`, `jsonwebtoken`, `bcrypt`, `cookie-parser`, `sharp`, `ai`, `@ai-sdk/google`, `@ai-sdk/anthropic` | PRD 7.1 |
| 백엔드 (S) | `passport`, `passport-google-oauth20` | PRD 7.1 |
| 백엔드 신규 | `multer`: Express는 multipart를 파싱하지 않으며 업로드 파싱은 보안 경계라 직접 구현하지 않는다(FR-11) | 신규 |
| 백엔드 신규 | `@aws-sdk/client-s3`: S3 호환 스토리지(Cloudflare R2, PRD-D-3) 접근 표준 클라이언트 | 신규 |
| 백엔드 신규 | `cheerio`: LLM 출력 정제, `data-block-id` 기준 편집, 워터마크 삽입을 정규식 없이 한 파서로 처리(FR-14, 16, 17, NFR-10) | 신규 |
| 백엔드 신규 | `express-rate-limit`: NFR-04 레이트 리밋. 메모리 저장소(프로세스별, 실효 한도는 ×2) | 신규 |
| 프론트 | `react`, `react-dom`, `typescript`, `vite`, `zustand`, `@tanstack/react-query` | PRD 7.1 |
| 프론트 신규 | `react-router`: `/app` 아래 6개 화면과 `:id` 파라미터, 뒤로가기(WF 2장) | 신규 |
| 개발 | `prettier`(신규: 포맷 논쟁 제거. 백엔드는 `.prettierrc`만 두고 패키지는 설치하지 않으며 `npx prettier`로 실행), Vite 템플릿 기본 ESLint, `k6`(PRD 9장, 별도 바이너리) | - |
| 쓰지 않음 | Prisma(금지), dotenv(`--env-file`), cors 패키지(`middleware/cors.js`로 직접 구현), helmet, zod·joi(수동 검증), axios(`fetch`), pino·winston(JSON `console.log`), supertest·jest·vitest(`node:test` + `fetch`), UI 키트·CSS 프레임워크 | - |

---

## 4. 코드 / 네이밍 원칙

### 4.1 네이밍 규칙

| ID | 대상 | 규칙 | 예 |
|---|---|---|---|
| NM-01 | 백엔드 파일·폴더 | 소문자 kebab-case, 폴더는 복수형 | `routes/projects.js`, `middleware/require-auth.js` |
| NM-02 | JS/TS 함수·변수 | camelCase, 동사로 시작. 상수는 UPPER_SNAKE | `reserveRegen()`, `MAX_REGEN = 3 // D-5` |
| NM-03 | React 컴포넌트·페이지 | PascalCase 파일·이름, 페이지는 `Page` 접미사 | `EditorPage.tsx`, `PreviewFrame.tsx` |
| NM-04 | 훅 | `use` + 명사(조회) / `use` + 동사(변경) | `useProject(id)`, `usePublish()` |
| NM-05 | Zustand 스토어 | `use{이름}Store`, 파일은 `stores/{이름}.ts` | `useAuthStore`, `useUiStore` |
| NM-06 | Query 키 | 배열, 첫 원소는 리소스 단수명 | `['me']`, `['projects']`, `['project', id]`, `['preview', id, version]` |
| NM-07 | SQL 테이블·컬럼 | snake_case, 테이블은 복수형(PRD 7.4 그대로). PK는 `uuid DEFAULT gen_random_uuid()`, 시각은 `timestamptz` `*_at`, 상태값은 PG enum 대신 `text + CHECK` | `projects.active_job_started_at` |
| NM-08 | 인덱스·제약 | 기본 이름을 쓰되 부분 유니크 인덱스만 명시: `{table}_{col}_{목적}_uq` | `credit_ledger_project_deduct_uq` |
| NM-09 | API 경로 | `/api` + 복수 명사 + kebab-case 하위 동작(PRD 8장 그대로) | `/api/projects/:id/ai-edits`, `/extension-token` |
| NM-10 | JSON 필드 | **camelCase.** 변환은 서비스의 리소스별 화이트리스트 매퍼(`toProject(row)`, `toMe(row)`) 한 곳에서만 한다. 매퍼가 필드를 고르므로 PP-05 차단도 겸한다. 범용 자동 변환기는 두지 않는다 | `selected_usps` → `selectedUsps` |
| NM-11 | 오류 응답 | `{ "error": { "code": "UPPER_SNAKE", "message": "..." } }` 하나로 통일. 성공은 리소스 JSON을 그대로 반환 | 4.2절 |
| NM-12 | 환경변수 | UPPER_SNAKE, 영역 접두어(`JWT_`, `S3_`, `LLM_`) | 6.1절 |
| NM-13 | 마이그레이션 | `NNN_설명.sql`(3자리, snake_case) | `001_init.sql`, `002_ai_edit.sql` |

### 4.2 오류 코드 (PRD 정의 + 아래 코드 전부 채택, C-2 해소)

새 코드를 만들지 않는다. 판정 우선순위: 401(인증) → 409(PUBLISHED 대상, BR-10·BR-46) → 403(이메일 미인증) → 402(잔액 부족) → 409(version·진행 중 작업) → 429(상한) → 503(대기열). 이메일 미인증과 잔액 0이 동시에 해당하면 403이다. 프론트는 `TOKEN_INVALID`를 받으면 갱신 시도 없이 인증 상태를 비우고 로그인 화면으로 보낸다(FR-40).


| HTTP | code | 상황 | 근거 |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | 입력 검증 실패, 편집 text에 태그, URL 패턴 외, 중복 이메일 가입(I-12), USP 0개 저장(I-10) | AC-BR20, 35, 36, 44 |
| 401 | `TOKEN_EXPIRED` / `TOKEN_INVALID` | Access·확장 토큰 만료 / 서명·`typ` 오류 | FR-05(PRD 정의) |
| 401 | `INVALID_CREDENTIALS` / `REFRESH_INVALID` | 로그인 실패 / refresh 무효·재사용·폐기 | FR-01, FR-37~39 |
| 402 | `INSUFFICIENT_CREDIT` | 잔액 0 | FR-06, AC-BR14 |
| 403 | `EMAIL_NOT_VERIFIED` / `ORIGIN_FORBIDDEN` / `NOT_PUBLISHED` | 미인증 / Origin 불일치 / 미퍼블리시 final 조회 | FR-06, FR-37, AC-BR52 |
| 404 | `NOT_FOUND` | 없는 리소스, **남의 프로젝트도 404**(존재 비노출), uuid 형식이 아닌 프로젝트 id | - |
| 409 | `VERSION_CONFLICT` / `JOB_IN_PROGRESS` / `INVALID_STATE` | version 불일치 / 진행 중 작업 / 허용되지 않는 상태(PUBLISHED 편집, 생성 전 preview, DRAFT·ANALYZED 퍼블리시 등) | FR-34, FR-35, BR-27, BR-46 |
| 429 | `ANALYZE_LIMIT` / `REGEN_LIMIT` / `AI_EDIT_LIMIT` / `DAILY_LLM_LIMIT` / `RATE_LIMITED` | 각 한도 초과 | BR-26, 34, 41, 45, 75, NFR-04 |
| 502 | `UPSTREAM_FAILED` | 크롤링·LLM 호출 실패·타임아웃 | I-4 |
| 503 | `LLM_BUSY` (+ `Retry-After`) | 세마포어·대기열 초과 | NFR-03 |
| 500 | `INTERNAL` | 그 외. message에 내부 정보 노출 금지 | - |

### 4.3 도메인 용어 매핑

| 한국어 용어 | 코드 식별자 | DB |
|---|---|---|
| 사용자 | `user`, `userId` | `users` |
| 크레딧 지갑 / 원장 | `wallet` / `ledger` | `credit_wallets` / `credit_ledger` |
| 사용 자격 | `eligible` (`assertEligible`) | - |
| 프로젝트 / 버전 | `project` / `version` | `projects.version` |
| 진행 중 작업 | `activeJob` (`activeJobType`) | `active_job_type`, `active_job_started_at` |
| 선점 / 확정 / 복원 | `reserve` / `commit` / `release` (`reserveRegen`, `releaseRegen`) | `*_count` |
| 분석 / USP 후보 / 선택 USP | `analyze` / `uspCandidates` / `selectedUsps` | `analysis_results.usp_candidates` / `projects.selected_usps` |
| 휘발성 크롤링 | `crawl` (`lib/crawler.js`) | 저장 없음 |
| 생성 / 재생성 | `generate` / `regenerate` | `regen_count` |
| 초안 HTML / 프리뷰 / 최종 HTML | `draftHtml` / `preview` / `finalHtml` | `draft_html` / 저장 안 함 / `final_html` |
| 블록 / 블록 ID | `block` / `blockId` | HTML 속성 `data-block-id` |
| 편집 필드 / 편집 ID | `field` / `editId` | HTML 속성 `data-edit-id`(블록 내 고유) |
| 수동 편집 / AI 부분 수정 | `edit` / `aiEdit` | `edit_operations.type` = `MANUAL` / `AI` |
| 원본 / 프리뷰 사본 / 공개 사본 | `originalKey` / `previewKey` / `publicKey` | `assets.original_key` 등 |
| 퍼블리시(확정) / 퍼블리시 기록 | `publish` / `publishRecord` | `publish_records` |
| 모델 역할 | `role` = `'LIGHT'` / `'MAIN'` (`callRole`) | `llm_usage_logs.role` |
| Access / Refresh / 확장 토큰 | `accessToken` / `refreshToken`(쿠키 `rt`) / `extToken` | - / `refresh_tokens` / `extension_tokens`(S) |
| 토큰 패밀리 | `familyId` | `family_id` |

### 4.4 주석과 포맷

| ID | 원칙 |
|---|---|
| NM-14 | 주석은 "왜"만 쓴다. 규칙 강제 지점에는 ID를 단다(`// BR-47: 분석은 실패해도 복원하지 않음`). 알고 쓰는 한계는 `// ponytail: {한계}, {개선 경로}`로 표시한다(예: 프로세스별 세마포어) |
| NM-15 | 포맷터는 루트 `.prettierrc` 하나로 세 폴더 공통. 린터는 프론트의 Vite 템플릿 기본 ESLint만 두고, 백엔드는 MVP에서 린터 없이 Prettier만 쓴다. pre-commit 훅은 두지 않는다 |
| NM-16 | 프론트 API 타입은 `api/types.ts`에 손으로 쓴다(백엔드가 JS라 코드 생성 없음). 백엔드 매퍼(NM-10)를 바꾸면 이 파일도 같이 바꾼다 |

---

## 5. 테스트 / 품질 원칙

### 5.1 도구

| ID | 원칙 | 이유 |
|---|---|---|
| QA-01 | 백엔드 테스트는 Node 내장 `node:test` + `node:assert`, HTTP는 `app.listen(0)` + 내장 `fetch` | 추가 의존성 0. `app.js`(조립)와 `server.js`(listen)를 나눠 테스트가 app을 직접 띄운다 |
| QA-02 | DB는 mock하지 않고 실제 PostgreSQL 17(로컬 설치 서버)의 테스트 DB를 쓴다. 각 테스트 파일은 필요한 행을 직접 INSERT하고 끝나면 TRUNCATE | 동시성·제약·TX가 핵심이라 mock으로는 검증되지 않는다(P-5) |
| QA-03 | **LLM mock은 어댑터 경계에서만.** `LLM_MAIN=mock:ok`처럼 provider `mock`을 두어 고정 HTML·지연·실패를 흉내 낸다. 서비스 코드에 테스트 분기를 넣지 않는다 | FR-27, PRD-V-6. 테스트와 부하 테스트가 같은 경로를 쓴다 |
| QA-04 | 크롤러·스토리지는 모듈 경계(`lib/crawler.js`, `lib/storage.js`)에서 테스트용 대체 함수를 주입한다(모듈 export 교체). 외부 네트워크를 테스트에서 호출하지 않는다 | - |
| QA-05 | 프론트 자동 테스트는 MVP에서 두지 않는다. `tsc --noEmit`과 E2E 수동 확인(PRD-V-1)으로 대신한다. FR-40 갱신 단일화는 `JWT_ACCESS_TTL_SEC=30`으로 줄여 수동 확인한다 | MVP 일정(P1 2일 + P2 5일), 신규 러너 추가 회피 |
| QA-06 | 부하 테스트는 k6 스크립트 2개: 비 LLM API 1,000 VU(PRD-V-5: p95 ≤ 300ms, 오류 < 1%), LLM mock 동시 생성 200건(PRD-V-6: 초과분 503 + Retry-After, 다운 0, 선점 누수 0) | PRD 9장 |

### 5.2 반드시 테스트할 것 (우선순위)

| 우선 | 대상 | 기대 결과 | 근거 |
|---|---|---|---|
| P0 | 동시 퍼블리시 2건 | DEDUCT 1건, 잔액 −1, 두 응답 finalHtml 해시 동일 | AC-BR13, AC-BR48, PRD-V-3 |
| P0 | 잔액 0 퍼블리시 / TX 중 실패(`publish_records` 선삽입으로 충돌 유발) | 402 / 롤백, 잔액·상태 불변, DEDUCT 0 | AC-BR12, AC-BR14 |
| P0 | PUBLISHED 재요청 | version 무관·잔액 0이어도 기존 결과, 추가 차감 없음 | BR-13, FR-34 |
| P0 | 동시 재생성·생성 2건 | LLM 1회, 나머지 409 | AC-BR39 |
| P0 | 카운트 상한·복원 | 재생성 4번째 429·LLM 0회, MAIN 실패 시 복원, 분석은 실패해도 소모 | AC-BR34, AC-BR26, BR-47 |
| P0 | version 충돌 | 같은 version 편집 2건 → 1건 성공, 1건 409 | AC-BR48 |
| P0 | JWT 회전·재사용 탐지·로그아웃 | 이전 `rt` 재사용 → 패밀리 전체 폐기, 최신 `rt`도 401. 로그아웃 뒤 401 | FR-37~39, AC-BR06 |
| P0 | JWT 검증 | 만료 → `TOKEN_EXPIRED`, `alg: none`·다른 키·`typ` 불일치 → `TOKEN_INVALID`, 웹 API에 ext 토큰 → 401 | FR-05, PRD 5.8, AC-BR03 |
| P0 | 프리뷰·응답 유출 | 퍼블리시 전 E2E 흐름의 **모든** 응답 본문에 원본 키 접두어, 공개 버킷 호스트, finalHtml 0건 | PRD-V-4, AC-BR32, AC-BR53 |
| P0 | HTML 정제 | script·link·style·class·`on*`·`javascript:` 0개, 모든 섹션 `data-block-id` | AC-BR30, AC-BR35, NFR-10 |
| P1 | 자격 | 미인증 403, 잔액 0 402, 잔액 0에서도 조회·final 200 | AC-BR04, AC-BR10 |
| P1 | 편집 입력 | text에 태그 → 400, draftHtml 불변. PUBLISHED 편집 409 | AC-BR44, AC-BR46 |
| P1 | LLM 보호 | 계정 21번째 MAIN 429·호출 0, 호출 N회 = 로그 N건, 대기열 초과 503 | AC-BR75, FR-28, NFR-03 |
| P1 | 선점 만료 | `active_job_started_at`을 5분 전으로 둔 뒤 job 1회 실행 → 복원·해제 | AC-BR47 |
| P1 | 가입·지급 | 가입 시 Wallet(0) 1건, grant 후 잔액 = 원장 합계 | AC-BR05, FR-07, BR-15 |
| P2 | 크롤링 원문 | 알려진 리뷰 문장이 DB·로그에 0건 | AC-BR22 |
| P2 | 비밀값 스캔 | `frontend/dist`, `extension/`에서 `sk-`, `AIza`, `postgresql://` 0건(grep 한 줄) | NFR-07, AC-BR63, AC-BR71 |

**테스트 배치** (여기의 P0·P1·P2는 테스트 우선순위이며 8-plan의 단계 P1·P2와 다르다): P0 테스트는 해당 기능을 만든 Task에서 바로 쓴다(단계 P1에 있는 퍼블리시 TX·유출 차단은 P1 안에서). 테스트 우선순위 P1·P2는 단계 P2의 배포 직전(OPS-02)에 한 번. 밀리면 테스트 P2 → P1 순으로 뒤로 미루고 P0는 넘기지 않는다(PRD-R-1).

### 5.3 Definition of Done (기능 1건)

- [ ] 해당 FR 수용 기준 충족, 관련 P0 테스트 통과(`node --test`)
- [ ] 오류는 4.2절 코드로만 응답, 응답은 화이트리스트 매퍼 경유
- [ ] 로그에 토큰·비밀번호·크롤링 원문·LLM 입출력 없음
- [ ] 스키마 변경은 새 마이그레이션 파일, 새 환경변수는 `.env.example`에 추가
- [ ] 규칙 강제 지점에 BR/FR ID 주석
- [ ] 쓰이지 않게 된 코드·import 제거, 요청 외 변경 없음(CLAUDE.md 외과적 변경)

---

## 6. 설정 / 보안 / 운영 원칙

### 6.1 환경변수 (`backend/.env.example`)

| 변수 | 용도 | 비고 |
|---|---|---|
| `NODE_ENV`, `PORT` | 실행 환경. 선택, 기본 `development` / `3000`. `NODE_ENV=production`이면 배포 변수(`FRONTEND_ORIGIN`, `LLM_*`, `S3_ENDPOINT`, `PUBLIC_IMAGE_BASE_URL`)가 필수 | OP-01 |
| `DB_CONN_STRING` | pg Pool 접속 | |
| `.env.test`의 `DB_CONN_STRING` | 테스트 DB 접속. 같은 키에 값은 `cal-todo-test` DB | QA-02, gitignore 대상 |
| `JOB_RESERVATION_INTERVAL_MS` | 선점 만료 복원 작업 주기. 선택, 기본 60000 | D-30 |
| `JOB_DAILY_INTERVAL_MS` | 일 단위 작업 주기. 선택, 기본 86400000 | |
| `FRONTEND_ORIGIN` | Origin 검사 대상 1개(서비스 도메인)이자 CORS 허용 출처 1개. production 필수, 그 외 기본 `http://localhost:5173` | NFR-09 |
| `TRUST_PROXY` | 앞단 프록시 홉 수. 선택, 기본 0(Cloudflare 뒤 배포 시 1) | NFR-04 |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 서로 다른 32바이트 이상 난수 | PRD 5.8 |
| `JWT_EXT_SECRET` | 확장 토큰 서명 (S) | FR-24 |
| `JWT_ACCESS_TTL_SEC` | 기본 900. 테스트에서만 줄인다 | QA-05 |
| `LLM_MAIN`, `LLM_LIGHT` | `provider:modelId` (`google:…`, `anthropic:…`, `mock:ok`). production 필수, 그 외 기본 `mock:ok`. google·anthropic이면 해당 API 키가 없을 때 시작 실패 | FR-27, PRD 7.2 |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY` | AI SDK 기본 변수명 그대로(SDK가 자동으로 읽음) | BR-71 |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | 스토리지 접속(Cloudflare R2: 엔드포인트는 R2 계정 S3 API URL, region은 `auto`). `S3_ENDPOINT`가 있으면 R2(S3 드라이버, `STORAGE_DRIVER='s3'`)이고 `S3_ACCESS_KEY_ID`·`S3_SECRET_ACCESS_KEY`·`S3_PRIVATE_BUCKET`·`S3_PUBLIC_BUCKET` 4개가 필수(`S3_REGION`은 기본 `auto`), 없으면 로컬 파일시스템 드라이버(개발·테스트). production은 `S3_ENDPOINT` 필수 | PRD-D-3 |
| `STORAGE_LOCAL_DIR` | `S3_ENDPOINT`가 없을 때 로컬 저장 디렉터리. 선택, 기본 `.storage`(테스트는 `.storage-test`) | DEC-07 |
| `S3_PRIVATE_BUCKET`, `S3_PUBLIC_BUCKET`, `PUBLIC_IMAGE_BASE_URL` | 원본·프리뷰 / 공개 사본 / 최종 HTML의 img 기준 URL. `PUBLIC_IMAGE_BASE_URL`은 production 필수, 그 외 기본 `http://localhost:3000/public-images`, 끝 `/` 제거. 로컬 드라이버에서는 `/public-images`를 서빙하지 않아 로컬 최종 HTML의 이미지는 깨진다(개발 한계) | FR-22 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | (S) OAuth | FR-02 |

`iss`·`aud`, Pool `max=20`, 상한·동시성 수치(D-5·20·27~30, NFR-03~05)는 환경변수가 아니라 `config.js` 상수다(PP-09). 배포마다 달라지는 값과 비밀값만 환경변수로 둔다. 구현된 상수: `DB_POOL_MAX`=20, `DB_STATEMENT_TIMEOUT_MS`=5000, `RESERVATION_TTL_MIN`=5, JWT `iss`·`aud` = `cal-todo`, `REFRESH_TTL_SEC`=14일, `REFRESH_FAMILY_MAX_DAYS`=30, `BCRYPT_ROUNDS`=10, 레이트 리밋 일반 60·로그인 10·refresh 30(`RATE_LIMIT_WINDOW_MS`=60000, 분당), `JSON_BODY_LIMIT`=1mb, `HTML_ROOT_WIDTH_PX`=780, `LLM_TIMEOUT_MS`=90000, `LLM_DAILY_LIMIT` MAIN 20·LIGHT 50, `LLM_CONCURRENCY` MAIN 20·LIGHT 40, `LLM_QUEUE_MAX`=100, `LLM_QUEUE_WAIT_MS`=30000, `LLM_RETRY_AFTER_SEC`=10, `FORM_LIMITS`(productName 100, category 50, intro 10~1000, toneGuide 200), `REGEN_MAX`=3, `ASSET_MAX_COUNT`=10, `ASSET_MAX_BYTES`=10MB, `ASSET_MIME`(jpeg·png·webp), `PREVIEW_IMAGE_WIDTH`=390, `ANALYZE_MAX`=3, `CRAWL_TIMEOUT_MS`=10000, `EDIT_TEXT_MAX`=2000. 이 중 `iss`·`aud`, `LLM_RETRY_AFTER_SEC`, category·toneGuide 상한, `EDIT_TEXT_MAX`는 문서에 근거가 없어 구현이 정한 값이다. LLM 호출은 재시도 없음(`maxRetries: 0`, 재시도는 호출자 몫).

### 6.2 원칙

| ID | 원칙 | 근거 |
|---|---|---|
| OP-01 | **설정 로딩은 `config.js` 한 곳.** `node --env-file=.env`로 읽고, 시작 시 필수 변수가 없거나 JWT 키가 32바이트 미만이면 즉시 종료한다. 다른 모듈은 `process.env`를 직접 읽지 않는다 | NFR-07 |
| OP-02 | `.env`는 git에 넣지 않는다. 운영은 호스팅 시크릿으로 주입한다. `.env.example`에는 키 이름과 형식 예시만 | P-2, PRD 7.2 |
| OP-03 | JWT: `algorithms: ['HS256']` 고정, `iss`·`aud`·`typ` 검사, 키는 용도별 분리. 클레임에 자격 정보(이메일 인증·잔액)를 넣지 않는다. refresh는 SHA-256 해시만 저장 | PRD 5.8, BR-06 |
| OP-04 | 쿠키 `rt`: `HttpOnly; Secure; SameSite=Strict; Path=/api/auth`. `/api/auth/refresh`·`/logout`은 `Origin === FRONTEND_ORIGIN`이 아니면 403. 프론트와 API는 **단일 도메인·동일 출처**(Express가 정적 파일과 `/api/*`를 함께 서빙, DEC-02)라 운영에서는 CORS 없이 Strict 쿠키가 그대로 전송된다(C-3). 개발 중 Vite(5173)가 백엔드(3000)를 직접 호출할 수 있도록 `cors` 미들웨어가 `FRONTEND_ORIGIN` 하나만 허용한다(`*` 미허용) | NFR-09, FR-37 |
| OP-05 | **입력 검증은 routes에서, 규칙 검증은 services에서.** routes는 타입·길이·형식(D-15 URL 패턴, D-18 폼, D-19 업로드)을 손으로 검사하고 400을 던진다. 상태·카운트·version 같은 규칙은 서비스·DB가 판정한다. `express.json({ limit: '1mb' })` | BR-20, BR-35, BR-36, BR-44 |
| OP-06 | 업로드는 `multer` 메모리 저장소, **요청당 1장**, 10MB·MIME 제한, 프로젝트당 10장은 DB 개수로 검사. `sharp`로 실제 이미지인지 한 번 더 확인한다(C-6). 필드명 `file`, 성공 201 `{id}`. 업로드는 version을 올리지 않고 진행 중 작업과 무관하다 | FR-11, D-19 |
| OP-07 | **LLM 출력은 저장 전에 반드시 `lib/html.js`로 정제**한다. 태그·속성 화이트리스트(허용 외 전부 제거), `style`·`src`(`asset:{uuid}`만, 그 외 `src`의 img는 제거. AC-BR50 근거로 draftHtml에 원본 URL·키를 넣지 않는다)·`alt`·`data-block-id`·`data-edit-id`만 허용, 누락된 `data-block-id`는 서버가 부여하고 편집 대상 텍스트 요소에는 블록 내 고유 `data-edit-id`를 부여(FR-17). 편집 적용·워터마크 삽입도 같은 모듈이 한다. 최종 HTML을 만들 때는 `data-edit-id`·`data-block-id`를 제거하고 `asset:{uuid}`를 `PUBLIC_IMAGE_BASE_URL/{assetId}.{ext}`로 바꾼다(FR-22). 프리뷰는 같은 참조를 390px 사본 data URI로 바꾼다 | FR-14, FR-16, FR-17, NFR-10 |
| OP-08 | 로깅: 요청마다 `crypto.randomUUID()` 요청 ID, 한 줄 JSON(`ts, level, reqId, userId, method, route, status, ms`). **요청·응답 본문, 쿠키, Authorization 헤더, 크롤링 원문, LLM 입출력은 로그 금지.** 크롤러·LLM 오류는 원문 없이 코드·상태만 남긴다. 세마포어 대기열 길이와 LLM 실패는 로그 필드로 남긴다 | NFR-11, NFR-18, BR-22, NFR-09 |
| OP-09 | 타임아웃: pg `statement_timeout` 5초, LLM 90초(`AbortSignal.timeout`), 크롤링 fetch 10초. 호스팅·프록시 요청 타임아웃은 90초보다 길게 설정한다 | NFR-02, NFR-05 |
| OP-10 | 마이그레이션: `backend/migrations/NNN_*.sql` 순수 SQL, 전진만(down 없음). 적용된 파일은 수정하지 않고 새 파일을 추가한다. `scripts/migrate.js`(pg만 사용)가 `schema_migrations` 테이블로 적용 여부를 기록하고 파일마다 TX로 실행한다 | PRD 9장, Prisma 금지 |
| OP-11 | 배포: 단일 도메인·동일 출처. Express가 `frontend/dist`(정적 랜딩 + SPA, `/app/*` → `app/index.html` 폴백)를 서빙하고 `/api/*`를 처리하며, 앞단 Cloudflare 프록시가 CDN 캐시를 맡는다. 백엔드는 Docker 이미지 1개 + PM2 2프로세스(VM 2 vCPU / 4GB), 관리형 PG 17, 스토리지 Cloudflare R2. 서버리스·별도 정적 호스팅 금지(LLM 90초). 배포 순서는 마이그레이션 → 프론트 빌드 → 백엔드 | PRD 7.6, D-31 |
| OP-12 | 헬스체크 `GET /healthz`: `SELECT 1` 성공 시 200 `{status:'ok'}`, 실패 시 503 `{status:'unavailable'}`. 인증·로그 없음. SIGTERM(Windows 개발은 SIGINT도)에서 `stopJobs()` → `server.close()` → `pool.end()` | NFR-12 |
| OP-13 | 백업: 관리형 PG 자동 백업 일 1회·7일 보존을 켠다(직접 스크립트 없음). 원장 대사 쿼리(잔액 ≠ 원장 합계 건수)는 일 1회 job이 실행하고 불일치가 있으면 `level=error`로 남긴다 | NFR-13, NFR-14 |
| OP-14 | 운영자 스크립트(`scripts/grant.js`)는 서비스 함수를 재사용하고 운영 DB에 직접 SQL을 치지 않는다 | FR-07, PRD-D-7 |

---

## 7. 디렉토리 구조

### 7.1 레포 최상위

```
cal-todo/
├─ frontend/          # Vite 프로젝트: 정적 SEO 랜딩(/) + React SPA(/app)
├─ backend/           # Express API, 마이그레이션, 운영 스크립트, 테스트
│  └─ migrations/     # 순수 SQL 마이그레이션(NNN_*.sql). DB를 만지는 곳이 백엔드뿐이라 여기에 둔다
├─ extension/         # (S) Chrome MV3 확장
├─ docs/              # 도메인·PRD·시나리오·와이어프레임·이 문서
├─ prompts/, valuate/ # 기존 작성 지침·평가(변경 없음)
├─ TEST_IMAGES/       # 디자인 시안 이미지(예: WF-01 랜딩 SVG). 빌드·배포 대상 아님
├─ CLAUDE.md          # 프로젝트 최상위 지침(작업 규칙, 문서 목록, 코딩 행동 지침)
├─ .prettierrc        # 세 폴더 공통 포맷
└─ .gitignore         # .env, node_modules, dist
```
폴더마다 독립 `package.json`을 두고 루트 워크스페이스·모노레포 도구는 쓰지 않는다(공유 코드가 없음).

### 7.2 프론트엔드

```
frontend/
├─ index.html           # 정적 랜딩. React 없음, title·description·본문 포함(FR-31)
├─ app/index.html       # SPA 진입. noindex 메타(FR-32)
├─ public/              # robots.txt(Disallow: /app), sitemap.xml (SPA 폴백은 Express가 처리)
├─ vite.config.ts       # 멀티 페이지 입력(/, /app), 개발용 /api 프록시
└─ src/
   ├─ main.tsx          # QueryClient·라우터 조립, 앱 시작 시 refresh 1회(FR-40)
   ├─ api/              # client.ts(fetch 래퍼·갱신 단일화·ApiError), 리소스별 호출 함수, types.ts
   ├─ hooks/            # TanStack Query 훅(useMe, useProjects, useProject, usePreview, useGenerate, usePublish …)
   ├─ stores/           # auth.ts(accessToken), ui.ts(선택 blockId·모달·토스트)
   ├─ pages/            # 화면 1개 = 파일 1개: Login, Projects, ProjectForm, Analyze, Editor(퍼블리시 모달 포함), Final
   ├─ components/       # 여러 화면 공용 + 큰 화면 조각: Header, Banner, Toast, PreviewFrame, BlockEditor, PublishModal
   └─ styles.css        # 전역 CSS 하나. 필요하면 컴포넌트 옆 *.module.css(Vite 기본 지원)
```
(S) 추가 예정: `pages/Billing`, `pages/VerifyEmail`, `components/AiEditPanel`, 확장 전송 버튼. 화면 대응: WF-02 Login, WF-03 Projects, WF-04 ProjectForm, WF-05 Analyze, WF-06·07 Editor, WF-08 Final.

### 7.3 백엔드

```
backend/
├─ package.json         # scripts: start, dev(--watch), migrate, grant, test(`.env.test`로 migrate 후 `node --test --test-concurrency=1`), test:coverage
├─ .env.example         # 6.1절 키 목록
├─ Dockerfile           # 이미지 1개, PM2 2프로세스(PRD 7.6)
├─ src/
│  ├─ server.js         # listen, jobs 시작, SIGTERM 종료 처리
│  ├─ app.js            # 미들웨어·라우터 조립, 개발용 /api-docs(LY-05). frontend/dist 정적 서빙·SPA 폴백은 OPS-01에서 추가. 테스트가 import
│  ├─ config.js         # 환경변수 로딩·검증, D 수치 상수(PP-09)
│  ├─ db.js             # pg Pool(max 20, statement_timeout 5s), query, withTx
│  ├─ middleware/       # cors, request-log, rate-limit, require-auth, error-handler
│  ├─ routes/           # auth, me, projects(생성·목록·상세·form·assets·usps·preview), analyze, generate, edit, publish(publish·final. extension-token·publish-report는 BE-20)
│  ├─ services/         # routes와 같은 이름: auth(토큰 발급·회전), credits(지갑·원장·지급), eligibility(assertEligible), projects, analyze, generate, edit, publish, preview
│  ├─ llm/index.js      # callRole, Role 매핑, 세마포어·대기열, 일일 상한, 사용량 로그, mock provider
│  ├─ lib/              # html.js(정제·블록 편집·워터마크), storage.js(S3·로컬), crawler.js(휘발성), errors.js(AppError), validate.js(version 검사)
│  └─ jobs/index.js     # setInterval: 선점 만료 복원(1분), refresh 만료 삭제·원장 대사(1일)
├─ migrations/          # 001_init.sql …
├─ scripts/             # grant.js(FR-07), migrate.js(OP-10)
└─ test/                # *.test.js(기능별: auth, refresh, eligibility, publish, reservation, preview, html, e2e(유출 검사) 등), helpers.js, load/*.js(k6, OPS-02)
```
(S) 추가 예정: `routes/billing.js`·`services/billing.js`(FR-08), Passport 설정(`services/auth.js` 안), `extension_tokens`·AI 수정 마이그레이션.

### 7.4 확장 프로그램 (S)

```
extension/
├─ manifest.json    # MV3. host_permissions: WING 상품등록 페이지·API 도메인만, externally_connectable: 프론트 도메인만
├─ background.js    # service worker: 웹 페이지 토큰 수신 → storage.session, GET /final, POST /publish-report
└─ content.js       # WING 상세설명 에디터 DOM 주입만(셀렉터는 상수, 원격 설정 FR-26은 C)
```

---

## 8. 원칙 위반 체크리스트와 확인 필요

### 8.1 코드 리뷰 체크리스트

- [ ] 한 번만 쓰는 추상화·래퍼·설정값을 새로 만들지 않았는가 (PP-01)
- [ ] 자격·잔액·카운트·상태를 프론트 값이나 "먼저 SELECT 후 판단"으로 결정하지 않았는가 (PP-02, PP-03)
- [ ] 한도 증가는 조건부 원자 UPDATE, 차감은 `withTx` + `FOR UPDATE` + 제약인가 (P-5)
- [ ] `withTx` 안에서 LLM·크롤링·스토리지를 호출하지 않는가 (PP-06, LY-03)
- [ ] LLM 결과 반영 시 version을 다시 확인하고, 실패·503·폐기 시 선점을 복원하는가 (FR-34, BR-47, BR-76)
- [ ] 응답이 화이트리스트 매퍼를 거치고 원본 키·draftHtml·finalHtml(미퍼블리시)·공개 URL이 없는가 (PP-05)
- [ ] LLM 출력이 `lib/html.js` 정제를 거쳐 저장되는가, 프리뷰는 sandbox iframe인가 (OP-07, LY-12)
- [ ] 서비스가 Provider·모델명을 모르는가 (PP-08)
- [ ] SQL이 파라미터 바인딩(`$1`)만 쓰는가(문자열 연결 0건)
- [ ] routes가 SQL을 직접 쓰지 않는가, services가 req/res를 모르는가 (LY-01, LY-02)
- [ ] 자격 검사 대상 API에서만 `assertEligible`(프로젝트 조회 직후, 미들웨어 아님), ext 토큰은 허용 2개 라우트뿐인가 (LY-06)
- [ ] 로그에 토큰·쿠키·본문·크롤링 원문·LLM 입출력이 없는가 (OP-08)
- [ ] `process.env`를 `config.js` 밖에서 읽지 않는가, 수치가 `config.js`에 D-ID와 함께 있는가 (OP-01, PP-09)
- [ ] 서버 데이터를 Zustand에 넣지 않았는가, 컴포넌트가 fetch를 직접 부르지 않는가 (LY-08, LY-09)
- [ ] 오류 응답이 4.2절 형식·코드인가 (NM-11)
- [ ] 새 의존성이면 3.5 표에 이유가 있는가 (LY-17)
- [ ] 스키마 변경이 새 마이그레이션 파일인가(기존 파일 수정 0) (OP-10)
- [ ] 용어가 4.3절 매핑표와 같은가 (PP-07)

### 8.2 확인 필요

| # | 항목 | 내용 / 제안 | 관련 |
|---|---|---|---|
| C-1 | 프리뷰 이미지 전달 | 해소(DEC-01, data URI 인라인). 서버가 비공개 버킷의 390px 워터마크 사본을 읽어 `data:image/webp;base64,...`로 프리뷰 HTML에 넣는다. 이유: sandbox iframe은 인증 헤더를 못 보내고, 서명 URL은 비공개 버킷 URL을 응답에 노출해 PP-05 유출 검사 대상이 된다. 단기 서명 URL은 쓰지 않는다 | FR-16, BR-50, 도메인 6장 데이터 소유 표, D-21, ERD E-8 |
| C-2 | 오류 코드 체계 | 해소(DEC-09, 4.2절 코드 전부 채택, 502 `UPSTREAM_FAILED` 포함). 판정 우선순위는 4.2절. 프론트의 `TOKEN_INVALID`는 갱신 시도 없이 인증 상태를 비우고 로그인 화면으로 보낸다 | I-4, I-7 |
| C-3 | 프론트·API 도메인 배치 | 해소(DEC-02, 단일 도메인·동일 출처). Express가 `frontend/dist`를 서빙하고 `/api/*`를 처리하며 앞단에 Cloudflare 프록시를 둔다. 운영에서는 CORS가 필요 없고 `SameSite=Strict` 쿠키가 그대로 전송된다(개발용 CORS는 `FRONTEND_ORIGIN` 하나만 허용). 별도 정적 호스팅은 쓰지 않는다 | PRD-D-2, D-31, NFR-09 |
| C-4 | 신규 라이브러리 승인 | 해소(DEC-03, 6개 모두 승인): `multer`, `@aws-sdk/client-s3`, `cheerio`, `express-rate-limit`, `react-router`, `prettier`(개발용). 이유는 3.5절 | LY-17 |
| C-5 | `requireEligible`과 PUBLISHED 재요청 | 해소(도메인 v0.3.3 BR-10, PRD v0.3.2 FR-06): PUBLISHED 대상 요청은 자격 검사 전에 처리한다. 퍼블리시는 서비스 TX 안에서 PUBLISHED 확인 뒤 자격을 확인하고, PUBLISHED 편집은 409(LY-06). 이후 프로젝트 대상 API 전체를 서비스 안 판정으로 통일 | I-1, FR-06, FR-34 |
| C-6 | 업로드 요청당 1장 | 해소(구현): `POST /assets`는 multipart 필드 `file` 1장씩(multer `files: 1`), 성공 201 `{id}`. 메모리 상한(요청당 10MB)을 위한 제안이었고 PRD는 "최대 10장"만 정하고 요청 단위는 정하지 않았다 | FR-11, D-19 |
| C-7 | 생성 API 동기 응답 | 가장 단순한 동기 응답(최대 90초 대기)을 전제로 구조를 잡았다. 작업 조회 API 방식으로 바꾸면 routes·hooks가 늘어난다 | N-7, NFR-02 |
| C-8 | 프로젝트 조회 응답 필드 | 해소(PRD v0.3.2 8장): `toProject`가 `version, status, analyzeCount, regenCount, aiEditCount, aiEditFailCount, activeJobType`을 돌려준다 | N-5 |
| C-9 | 폼 저장 위치 | 해소(DEC-05, 별도 저장 API). `PUT /api/projects/:id/form`(body `{form, version}`, 자격 FR-06, DRAFT·ANALYZED만, 그 외 409). `POST /api/projects`는 `form`을 선택적으로 받는다. 필수값 검증(BR-35)은 생성 요청 시점 | I-8, E-5 |
| C-10 | 분석 선점과 503·429 | 해소(도메인 v0.3.3 BR-47): 실행된 분석 시도는 실패해도 복원하지 않고, LLM 미호출 거절(BR-75, BR-76)은 선점을 복원한다. 순서 변경은 불필요 | I-6, BR-26 |
