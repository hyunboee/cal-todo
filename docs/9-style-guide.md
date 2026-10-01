# Coupang AI Detail Maker - 프론트엔드 스타일 가이드 (v0.1 초안)

## 1. 문서 정보

| 항목 | 내용 |
|---|---|
| 버전 | v0.1 |
| 작성일 | 2026-10-01 |
| 작성자 | hyunboee (Claude 작성) |
| 근거 | `TEST_IMAGES/wf-01-landing.svg` (WF-01 정적 랜딩 스타일 시안, 우측에 에디터 WF-06 목업 포함) |
| 기준 문서 버전 | 와이어프레임 v0.1.11, 구조 원칙 v0.1.13, PRD v0.3.12 |
| 적용 대상 | **앱 UI만**(SPA 화면, 정적 랜딩). 상세페이지 **프리뷰 HTML(780px, 인라인 CSS, LLM 생성)은 적용 대상이 아니다.** 프리뷰를 감싸는 캔버스·워터마크 오버레이만 앱 UI로 다룬다(6.10) |
| 표기 | `[가정]` = SVG에 근거가 없어 팔레트에 맞춰 정한 값(9장에 모음). `[통합]` = SVG의 비슷한 값을 하나로 합친 것 |

### 변경 이력

| 버전 | 일자 | 변경자 | 기준 문서 버전 | 변경내용 |
|---|---|---|---|---|
| v0.1 | 2026-10-01 | hyunboee (Claude 작성) | 와이어프레임 v0.1.11, 구조 원칙 v0.1.13, PRD v0.3.12 | 최초 작성 |

기준 문서(와이어프레임·구조 원칙·PRD)가 갱신되면 이 문서도 함께 갱신하고 위 표에 행을 맨 위로 추가한다.

---

## 2. 디자인 원칙

- **다크 단일 테마.** 거의 검정(`#07080c`)에 한 단계씩 밝아지는 면으로 계층을 만든다. 라이트 모드는 없다.
- **강조색은 블루 하나.** 주요 행동(버튼)·선택 상태·숫자/키워드 강조만 블루. 그 외는 무채색 회색 계층.
- **정보 밀도가 높고 작다.** 에디터 UI는 12~13px, 반경은 3~8px의 각진 편이다. 큰 반경은 배지(pill)에만 쓴다.
- **구분은 면 밝기 + 1px 테두리.** 그림자는 쓰지 않는다. 블루 글로우(radial)는 랜딩 배경에만 쓴다.

---

## 3. 컬러 토큰

### 3.1 배경·테두리

| 토큰 | 값 | SVG 근거 | 용도 |
|---|---|---|---|
| `--color-bg-page` | `#07080c` | 최상위 rect | 페이지 배경 |
| `--color-bg-iconbar` | `#0b0d12` | 좌측 아이콘 바 | 에디터 아이콘 바 |
| `--color-bg-code` | `#0a0b10` | 코드 패널 | 코드 블록 |
| `--color-bg-frame` | `#0e1016` | 에디터 프레임 | 에디터 본체 |
| `--color-bg-block` | `#0f1118` | 블록 편집 패널 | 우측 편집 패널 |
| `--color-bg-chip` | `#11131c` | NEW 칩 | 칩 바탕 |
| `--color-bg-toolbar` | `#12141c` | 툴바 | 에디터 툴바 |
| `--color-bg-panel` | `#12141d` | USP 패널 | 카드·패널 `[통합]` 툴바와 한 단계 차이 |
| `--color-bg-tile` | `#141726` | 기능 아이콘 타일 | 아이콘 타일 |
| `--color-bg-input` | `#161925` | 텍스트 입력 | 입력·텍스트에리어 |
| `--color-bg-control` | `#1b1e2a` | 에디터 드롭다운, 저장, B1 | Secondary 버튼, 작은 컨트롤 |
| `--color-border-subtle` | `#1c1f2b` | 코드 패널 stroke | 코드 블록 테두리 |
| `--color-border` | `#1f2230` | 프레임 stroke, 구분선 | 기본 테두리·구분선 |
| `--color-border-chip` | `#23263a` | NEW 칩 stroke | 칩 테두리 |
| `--color-border-panel` | `#262a3b` | USP 패널 stroke | 패널·입력 테두리 |
| `--color-border-check` | `#4a4e63` | 미체크 체크박스 | 체크박스 테두리 |

### 3.2 텍스트

| 토큰 | 값 | SVG 근거 | 용도 |
|---|---|---|---|
| `--color-text-strong` | `#ffffff` | 제목·버튼 글자 | 제목, 버튼 글자 |
| `--color-text` | `#d7d9e3` | 툴바·패널 본문 (`#e6e7ee` 로그인 링크 `[통합]`) | UI 기본 텍스트 |
| `--color-text-secondary` | `#b9bccb` | 히어로 본문 (`#c9cbd6` 내비 `[통합]`) | 설명문, 내비 링크 |
| `--color-text-muted` | `#8a8ea3` | 카드 설명, 툴바 상태 (`#9a9db0` 단계 `[통합]`) | 보조 텍스트 |
| `--color-text-subtle` | `#6d7185` | 라벨, 닫기 ×, 시도 횟수 | 라벨·캡션 |
| `--color-text-disabled` | `#4d5166` | 하단 주석, 코드 주석 | **보조 텍스트 전용**(주석·비활성). 본문·중요 정보에 쓰지 않는다 |
| `--color-icon` | `#5c6075` | 아이콘 바 stroke | 비활성 아이콘 |

### 3.3 브랜드 블루

| 토큰 | 값 | SVG 근거 | 용도 |
|---|---|---|---|
| `--color-brand` | `#4353ff` | 로고·버튼·체크박스 fill | Primary 버튼, 체크됨, 로고 |
| `--color-brand-alt` | `#5247ff` | "상세페이지 생성" 버튼 | 생성(주요 LLM 행동) 버튼 변형 |
| `--color-accent` | `#4f63ff` | "AI", 단계 번호 | 텍스트 강조 |
| `--color-accent-light` | `#6f7dff` | 아이콘 타일 글리프 | 타일 아이콘 |
| `--color-accent-lighter` | `#8f9bff` | ✦ 글리프 | 패널 제목 아이콘 |
| `--color-badge-text` | `#9fa8ff` | 배지·선택 글자 | 배지 글자, 선택 행 글자 |
| `--color-badge-bg` | `#1a1f4d` | AI 배지, hero 칩 | 배지 배경, 선택 행 배경 |
| `--color-badge-bg-light` | `#1d2140` | LIGHT 배지 | 작은 배지 배경 |
| `--color-brand-hover` | `#5566ff` | - | `[가정]` Primary hover |
| `--color-brand-active` | `#3544e6` | - | `[가정]` Primary active |

### 3.4 그라데이션·워터마크

| 토큰 | 값 | SVG 근거 | 용도 |
|---|---|---|---|
| `--gradient-glow` | `radial-gradient(circle at 72% 42%, rgba(42,60,255,.55), rgba(42,60,255,0) 45%)` | `#glow` | 랜딩 배경 글로우(WF-01만) |
| `--gradient-canvas` | `linear-gradient(135deg, #0b1030, #1a2a8a)` | `#canvasBg` | 프리뷰 캔버스 배경 |
| `--color-canvas-orb` | `rgba(51,70,255,.35)` | 캔버스 원 `#3346ff` | 캔버스 장식(선택) |
| `--color-watermark` | `rgba(255,255,255,.08)` | 반복 패턴 fill-opacity | 반복 워터마크 |
| `--color-watermark-strong` | `rgba(255,255,255,.18)` | 대형 문구 fill-opacity | 대형 워터마크 문구 |

### 3.5 코드 하이라이트

| 토큰 | 값 | SVG 근거 |
|---|---|---|
| `--color-code-tag` | `#e0a86a` | 태그·기호 |
| `--color-code-attr` | `#7fb0ff` | 속성명 |
| `--color-code-string` | `#9fd48a` | 문자열 |
| `--color-code-text` | `#d7d9e3` | 본문 텍스트(= `--color-text`) |
| `--color-code-comment` | `#4d5166` | 주석(= `--color-text-disabled`) |

### 3.6 상태색 `[가정]` (SVG에 없음)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--color-error` / `--color-error-bg` | `#ff6b6b` / `#2a1418` | 400 인라인 오류, 실패 |
| `--color-warn` / `--color-warn-bg` | `#f5b14c` / `#2a2214` | 402·403 배너, 429 토스트 |
| `--color-success` / `--color-success-bg` | `#4ade80` / `#11251a` | 복사 성공, 인증됨 |
| `--color-info` / `--color-info-bg` | `#8f9bff` / `#1a1f4d` | 진행 중 작업·503·409 (블루 계열 재사용) |
| `--color-focus` | `#6f7dff` | 포커스 링(2px outline, offset 2px) |

---

## 4. 타이포그래피

| 항목 | 값 |
|---|---|
| 폰트 스택 | `Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif` (SVG 그대로) |
| 웹폰트 로딩 `[가정]` | 별도 설치 없이 `index.html` `<head>`에 CDN `<link>` 한 줄(Pretendard 공식 jsDelivr dynamic-subset CSS). 로딩 실패 시 뒤의 시스템 폰트로 폴백 |
| 모노 | `Consolas, 'D2Coding', monospace` (SVG 코드 패널) |

| 토큰 | 크기/굵기/자간 | 행간 | SVG 근거 | 용도 |
|---|---|---|---|---|
| `display` | 66 / 800 / -2px | 1.2 | 히어로 헤드라인 | WF-01 헤드라인만. 모바일은 40으로 축소 `[가정]` |
| `title` | 19 / 700 / 0 | 1.3 | "Detail Maker" 로고 | 헤더 로고 텍스트 |
| `body-lg` | 18 / 400 / 0 | 1.55 | 히어로 본문(줄 간격 28) | 랜딩 본문 |
| `btn-lg` | 16 / 600 / 0 | 1 | 히어로 CTA | 랜딩 큰 버튼 |
| `ui-md` | 15 / 400·600 / 0 | 1.4 | 헤더 링크·버튼 | 내비, 헤더 버튼 |
| `ui-step` | 14 / 400·700 / 0 | 1.4 | 작동 방식 단계 | 단계 목록 |
| `ui-sm` | 13 / 400·700 / 0 | 1.4 (카드 설명 줄 간격 18) | 기능 카드, 패널 제목, 생성 버튼 | 카드·패널 제목·본문, 입력 |
| `ui-xs` | 12 / 400·600 / 0 | 1.4 | 툴바, 체크 항목, 코드 | 에디터 툴바·목록·코드 |
| `caption` | 11 / 400 / 0 | 1.4 | 라벨, 캡션 | 라벨·캡션 |
| `caption-caps` | 11 / 400 / 1.5~2px | 1 | NEW 칩, "작동 방식 — 5단계" | 영문/소제목 대문자 느낌 칩 |
| `micro` | 10 / 400 / 0 | 1.4 | 시도 횟수, 패널 내 소 텍스트 | 사용량 표시(`분석 시도 1/3`) |
| `badge` | 9 / 400 / 0 | 1 | LIGHT | 작은 배지 글자(가독성 위해 앱에서 10 허용 `[가정]`) |

프리뷰 캔버스 안의 문구(38/700/-1 등)는 프리뷰 HTML의 영역이라 토큰을 만들지 않는다.

---

## 5. 간격·레이아웃

### 5.1 간격 스케일

SVG의 간격(10·12·16·24·30·48 등)에서 4px 기반으로 정리했다.

| 토큰 | 값 | 예시 |
|---|---|---|
| `--space-1` | 4px | 아이콘-글자 미세 간격 |
| `--space-2` | 8px | 버튼 내 간격, 칩 내부 |
| `--space-3` | 12px | 패널 내부 여백(SVG 12~16), 툴바 좌우 |
| `--space-4` | 16px | 패널 패딩(SVG 16), 항목 간격 |
| `--space-6` | 24px | 카드 그룹 간격 |
| `--space-8` | 32px | 섹션 내 큰 간격 |
| `--space-12` | 48px | 페이지 좌우 여백(SVG 48), 히어로 섹션 간격 |

### 5.2 모서리 반경

| 토큰 | 값 | SVG 사용처 |
|---|---|---|
| `--radius-xs` | 3px | 작은 배지·입력·저장 버튼·칩 행 (rx=3) |
| `--radius-sm` | 4px | 버튼 전반, 툴바 컨트롤 (rx=4), 로고 마크 작은 것 |
| `--radius-md` | 6px | 아이콘 타일, 코드·블록 패널 (rx=6), 로고 마크(rx=7)도 6으로 `[통합]` |
| `--radius-lg` | 8px | 패널, 에디터 프레임 (rx=8) |
| `--radius-xl` | 10px | 이미지 자리표시 프레임 (rx=10) (사용처 생기면 사용) |
| `--radius-pill` | 999px | NEW 칩·AI 배지 (rx=13, 17) |

체크박스는 3px(`--radius-xs`).

### 5.3 그리드·레이아웃

| 항목 | 값 | 근거 |
|---|---|---|
| 기준 폭 | 데스크톱 1440, 좌우 여백 48px (`--space-12`) | 헤더·히어로 x=48 |
| 헤더(랜딩) | 높이 약 90 (로고 y=30, 버튼 22~68) | SVG 헤더 |
| 헤더(앱, WF-03~) | 높이 64 `[가정]`, 좌우 48 | 와이어프레임 5.1 |
| 에디터 툴바 | 높이 40, 좌우 12 | 툴바 rect |
| 에디터 3단 | 아이콘 바 38px / 프리뷰(가변) / 우측 패널 | 목업 구조 |
| 우측 패널 폭 | 224~208 (목업) → 앱은 280 `[가정]` | USP·블록 패널 |
| 에디터 프레임 | 반경 8, 1px `--color-border` | 프레임 rect |

### 5.4 반응형

| 구간 | 규칙 |
|---|---|
| 360px 이상 | 최소 지원 폭(NFR-17). 가로 스크롤이 생기지 않게 한다 |
| 768px 미만 `[가정]` (브레이크포인트 1개) | 좌우 여백 16px, `display`를 40으로, 헤더는 로고·잔액·메뉴로 축약(와이어프레임 5.1) |
| 에디터 모바일 | 와이어프레임 WF-06 모바일 안: 프리뷰 약 46% 축소 → 편집 패널을 프리뷰 아래로, 퍼블리시 버튼 하단 고정. 아이콘 바는 숨김 `[가정]` |

---

## 6. 컴포넌트 스펙

공통: 비활성은 `opacity` 대신 색 교체. 포커스는 `--color-focus` 2px outline. 전환은 `background-color .15s` 정도(그 이상의 모션 없음).

### 6.1 버튼

| 종류 | 크기·패딩 | 색 | 반경 | hover | disabled | loading |
|---|---|---|---|---|---|---|
| Primary (헤더) | 높이 46, 가로 패딩 24, `ui-md`/600 | bg `--color-brand`, 글자 `#fff` | `--radius-sm` | bg `--color-brand-hover` `[가정]` | bg `--color-bg-control`, 글자 `--color-text-subtle` | 글자 앞 스피너 + 클릭 무시 |
| Primary (히어로) | 높이 52, 폭 206, `btn-lg`/600 | 위와 동일 | `--radius-sm` | 동일 | 동일 | 동일 |
| Primary (툴바 소형) | 높이 24, 가로 패딩 12, `ui-xs`/600 ("퍼블리시 · 1크레딧") | 위와 동일 | `--radius-sm` | 동일 | 동일 | 동일 |
| 생성 (패널) | 높이 40, 패널 폭 꽉 채움, `ui-sm`/600 ("✦ 상세페이지 생성") | bg `--color-brand-alt` | `--radius-sm` | 밝기 +8% `[가정]` | 동일 | 동일 |
| 텍스트 링크형 | 패딩 없음, `ui-md`, 히어로는 `btn-lg`/600 + `›` 화살표 | 글자 `--color-text` (히어로는 `#fff`) | - | 글자 `#fff` | 글자 `--color-text-subtle` | - |
| Secondary | 높이 22~24, 패딩 8~12, `ui-xs` | bg `--color-bg-control`, 글자 `--color-text` ("저장", "에디터 ▾") | `--radius-xs`~`--radius-sm` | bg `#242838` `[가정]` | 글자 `--color-text-subtle` | 동일 |
| Outline | 높이 34, 패딩 16, `ui-xs` | 1px `#e6e7ee`, 투명 배경, 글자 `#fff` | `--radius-sm` | bg `rgba(255,255,255,.06)` `[가정]` | border·글자 `--color-text-subtle` | 동일 |

### 6.2 배지·칩

| 종류 | 크기·패딩 | 색 | 반경 |
|---|---|---|---|
| 칩(NEW) | 높이 34, 패딩 0 16 / 글자 `caption-caps` | bg `--color-bg-chip`, border `--color-border-chip`, 글자 `--color-text-muted` | pill |
| AI 배지 | 높이 26, 패딩 0 16 / `ui-sm`/600 | bg `--color-badge-bg`, 글자 `#fff`, ✦ `--color-badge-text` | pill |
| 작은 배지(LIGHT) | 높이 16, 폭 42 / `badge` | bg `--color-badge-bg-light`, 글자 `--color-badge-text` | `--radius-xs` |
| 상태(EDITING 등) | 툴바 안 텍스트 `ui-xs`, `--color-text-muted`. 배지가 필요하면 LIGHT와 동일 `[가정]`. PUBLISHED는 `--color-success` 글자 + `--color-success-bg` `[가정]` | | |

### 6.3 아이콘 타일

38x38, bg `--color-bg-tile`, `--radius-md`, 글리프 16px `--color-accent-light` 중앙 정렬. 옆에 제목 `ui-sm`/700 `#fff` + 설명 `ui-sm` `--color-text-muted`(줄 간격 18). 클릭 요소가 아니므로 hover 없음.

### 6.4 카드·패널

bg `--color-bg-panel`, 1px `--color-border-panel`, `--radius-lg`, 패딩 `--space-4`. 제목행: `ui-sm`/700 `#fff` + 아이콘 `--color-accent-lighter` + (배지) + 우측 닫기 ×(`--color-text-subtle`, hover `#fff`). 부제 `caption` `--color-text-muted`. 구분선 1px `--color-border`.

### 6.5 체크박스

| 상태 | 스타일 |
|---|---|
| 체크 | 14x14, bg `--color-brand`, 체크 표시 `#fff` 1.6px, 반경 3 |
| 미체크 | 14x14, 투명, 1px `--color-border-check`, 반경 3 |
| 라벨 | `ui-xs` `--color-text`, 체크박스와 8px 간격, 행 간격 26(= 높이 14 + 12) |
| hover `[가정]` | 미체크 border `--color-text-muted` |
| disabled `[가정]` | 라벨 `--color-text-subtle`, border `--color-border` |

### 6.6 텍스트 입력·텍스트에리어

| 항목 | 스펙 |
|---|---|
| 입력 | 높이 20(목업)은 작아 앱은 36 `[가정]`, bg `--color-bg-input`, 1px `--color-border-panel` `[가정]`, `--radius-xs`, 글자 `ui-sm` `--color-text` |
| 텍스트에리어 | 입력과 동일, 최소 높이 96 `[가정]`, 세로 리사이즈만 |
| placeholder | `--color-text-subtle` |
| focus | border `--color-brand` + 포커스 링 |
| disabled | 글자 `--color-text-subtle`, 커서 not-allowed |
| 오류(400) | border `--color-error`, 아래 `caption` `--color-error` 문구 |
| 라벨 | `caption` `--color-text-subtle`, 입력 위 또는 왼쪽 |

### 6.7 툴바 (WF-06 상단)

높이 40, bg `--color-bg-toolbar`, 상단 모서리 `--radius-lg`, 좌우 패딩 12. 좌→우: 로고 마크(20x20, `--color-brand`, `--radius-sm`) · 모드 드롭다운(Secondary) · `프로젝트명 · 상태 · vN`(`ui-xs` `--color-text-muted`) · 남은 횟수 `재생성 2/3`(`ui-xs` `--color-text-muted`, 우측) · 퍼블리시 버튼(Primary 소형, 맨 오른쪽). 횟수 소진 시 숫자를 `--color-warn`으로 `[가정]`. 모바일에서는 퍼블리시 버튼이 하단 고정 바(bg `--color-bg-toolbar`, 상단 1px `--color-border`)로 이동한다.

### 6.8 블록 선택 목록·편집 패널

패널 bg `--color-bg-block`, `--radius-md`, 패딩 12. 항목행: 높이 20~28, `ui-xs`. 선택 항목은 bg `--color-badge-bg` + 글자 `--color-badge-text`(hero 칩과 동일), 비선택은 bg `--color-bg-input` + 글자 `--color-text-muted`, hover 시 글자 `--color-text` `[가정]`. 번호 칩 `B1`은 26x20 `--color-bg-control` `micro`. 라벨은 `caption` `--color-text-subtle`, 구분선 1px `--color-border`. 퍼블리시 후(읽기 전용)는 입력·저장 disabled.

### 6.9 코드 블록 (WF-08 최종 HTML)

bg `--color-bg-code`, 1px `--color-border-subtle`, `--radius-md`, 패딩 `--space-4`, 모노 12px, 행간 약 1.7(SVG 줄 간격 20~24), 색은 3.5절. 가로 스크롤 허용, 줄바꿈 없음. 복사 버튼은 우측 상단 Secondary 소형.

### 6.10 워터마크 오버레이 표현 (앱 UI)

프리뷰 iframe 위에 겹치는 CSS 레이어(iframe은 `pointer-events` 영향 없도록 레이어에 `pointer-events:none`). 서버가 삽입한 이미지 워터마크와 별개로 표시하는 UI 표현이다.

| 요소 | 스펙 |
|---|---|
| 반복 패턴 | 문구 `PREVIEW ONLY`, 12px/700, `--color-watermark`, 타일 170x90, -25도 회전 |
| 대형 문구 | `PREVIEW ONLY / 무단 복제 금지`, 26px/800, `--color-watermark-strong`, -18도, 캔버스 하단부 |
| 캔버스 배경 | `--gradient-canvas` (프리뷰가 로딩되기 전·여백) |

### 6.11 헤더 (와이어프레임 5.1)

| 요소 | 스펙 |
|---|---|
| 로고 | 30x30 마크(`--color-brand`, `--radius-md`, 글자 "C" 15/800 `#fff`) + `title` "Detail Maker" |
| 잔액 | `ui-md` `--color-text`, 숫자는 `#fff`/600. 0이면 `--color-warn` + 충전 안내 링크 |
| 인증 표시 | `ui-sm`: 인증됨 `--color-success`, 미인증 `--color-warn` |
| 로그아웃 | 텍스트 링크형 |
| 구분 | 항목 사이 1px 세로선 `--color-border`, 헤더 하단 1px `--color-border` |
| 모바일 | 로고·잔액·메뉴 버튼(인증 표시·로그아웃은 메뉴 안) |
| WF-01 헤더 | 별도: 로고, 내비("작동 방식"·"기능", `ui-md` `--color-text-secondary`), 로그인 링크, Primary 버튼 |

### 6.12 오류 배너·토스트 (와이어프레임 5.2 / 시나리오 3장)

배너: 화면 상단 전폭, 패딩 `--space-3 --space-12`, `ui-sm`, 좌측 3px 색 막대, bg는 `*-bg`, 글자 `--color-text`, 아이콘·막대 색은 상태색. 토스트: 우측 하단 고정(모바일은 하단 전폭), 폭 최대 360, `--radius-lg`, 1px 테두리 상태색, 4초 후 자동 소멸 `[가정]`. 인라인(400): 6.6의 오류 스타일.

| 응답 | 표시 | 색 |
|---|---|---|
| 401 | 표시 없음 | - |
| 403 (이메일 미인증) | 배너 | warn |
| 402 (잔액 0) | 배너 | warn |
| 409 | 토스트 | info |
| 429 | 토스트 | warn |
| 503 + `Retry-After` | 배너(대기 안내) | info |
| 400 | 필드 인라인 | error |
| 진행 중 작업 | 상단 배너 + 관련 버튼 disabled | info (스피너 포함) |
| 복사 성공 | 토스트 | success |

### 6.13 모달 (WF-07 퍼블리시 확인)

오버레이 `rgba(0,0,0,.6)` `[가정]`. 본체: 폭 440(모바일은 좌우 16 여백), bg `--color-bg-panel`, 1px `--color-border-panel`, `--radius-lg`, 패딩 `--space-6`. 제목 `title` 크기 `#fff`, 본문 `ui-sm` `--color-text`, 잔액 변화는 `#fff`/600. 하단 우측 정렬: 취소(Secondary) + 확정(Primary), 간격 8. 처리 중에는 두 버튼 disabled + 확정에 스피너. 오류 영역은 6.12 인라인 error/warn 스타일. 닫기 ×는 6.4와 동일.

### 6.14 빈 상태·로딩

| 항목 | 스펙 |
|---|---|
| 빈 상태(WF-03 목록 없음) | 패널 안 중앙, 아이콘 타일 + `ui-sm` `--color-text-muted` 문구 + Primary 버튼 1개 |
| 로딩(화면) | 중앙 스피너(16~24px, `--color-accent` 원호, 라이브러리 없이 CSS) + `caption` 문구 |
| 로딩(프리뷰) | 캔버스에 `--gradient-canvas` + 중앙 스피너 |
| 스켈레톤 | 쓰지 않는다(오버엔지니어링) |

---

## 7. 화면 적용 매핑 (M)

| 화면 | 컴포넌트 | 주요 토큰 |
|---|---|---|
| WF-01 정적 랜딩 | 랜딩 헤더, 칩/AI 배지, `display` 헤드라인, Primary(히어로)·텍스트 링크, 아이콘 타일 3개, 단계 목록, (우측 에디터 목업) | `bg-page`, `gradient-glow`, `brand`, `accent`, `text-secondary`, `radius-pill` |
| WF-02 로그인·가입 | 카드, 입력, Primary, 텍스트 링크, 인라인 오류 | `bg-panel`, `border-panel`, `bg-input`, `error` |
| WF-03 프로젝트 목록 | 헤더, 카드(프로젝트 행), 상태 배지, Primary, 빈 상태, 배너(402/403) | `bg-panel`, `badge-*`, `warn`, `success` |
| WF-04 새 프로젝트 | 입력, 텍스트에리어, Primary/Secondary, 인라인 오류, 429 토스트 | `bg-input`, `radius-xs`, `error` |
| WF-05 경쟁사 분석·USP | USP 카드, 체크박스, 사용량 `micro`, 생성 버튼, 진행 중 배너 | `bg-panel`, `brand`, `brand-alt`, `info` |
| WF-06 에디터 | 툴바, 아이콘 바, 프리뷰 캔버스+워터마크, 블록 목록, 편집 패널, Primary 소형, 배너/토스트 | `bg-toolbar`, `bg-iconbar`, `gradient-canvas`, `watermark*`, `badge-*` |
| WF-07 퍼블리시 모달 | 모달, Secondary+Primary, 인라인 오류 | `bg-panel`, `border-panel`, `warn` |
| WF-08 퍼블리시 완료 | 코드 블록, 복사 버튼, 토스트(성공), 상태 배지 PUBLISHED | `bg-code`, `code-*`, `success` |
| S (WF-09~12) | 기존 컴포넌트 재사용(채팅 패널은 6.4 카드 + 6.6 입력, 충전·인증은 카드 + 배너). 새 토큰 없음 | - |

---

## 8. 구현 가이드

**스타일링 방식**: 구조 원칙 7.2·3.5가 "전역 `styles.css` 하나 + 필요 시 컴포넌트 옆 `*.module.css`, UI 키트·CSS 프레임워크 금지"로 이미 정했으므로 그대로 따른다. 새 의존성 없음.

**파일 위치**
- 앱: `frontend/src/styles.css` 맨 위에 아래 `:root` 블록을 둔다(별도 파일을 만들지 않는다). 컴포넌트별 CSS는 `*.module.css`에서 `var(--...)`로 참조.
- 정적 랜딩(`frontend/index.html`)은 SPA 코드를 import하지 않으므로(LY-13) 같은 `:root` 블록을 `<style>`에 복사한다(확인 필요 9장).

**명명 규칙**: `--color-{bg|text|border|brand|accent|badge|code|상태}-{변형}`, `--gradient-*`, `--space-{배수}`, `--radius-{xs..xl|pill}`, `--font-*`, `--fs-*`(크기). 컴포넌트 클래스는 소문자 kebab-case.

```css
:root {
  /* 배경·테두리 */
  --color-bg-page: #07080c;
  --color-bg-iconbar: #0b0d12;
  --color-bg-code: #0a0b10;
  --color-bg-frame: #0e1016;
  --color-bg-block: #0f1118;
  --color-bg-chip: #11131c;
  --color-bg-toolbar: #12141c;
  --color-bg-panel: #12141d;
  --color-bg-tile: #141726;
  --color-bg-input: #161925;
  --color-bg-control: #1b1e2a;
  --color-border-subtle: #1c1f2b;
  --color-border: #1f2230;
  --color-border-chip: #23263a;
  --color-border-panel: #262a3b;
  --color-border-check: #4a4e63;
  /* 텍스트 */
  --color-text-strong: #ffffff;
  --color-text: #d7d9e3;
  --color-text-secondary: #b9bccb;
  --color-text-muted: #8a8ea3;
  --color-text-subtle: #6d7185;
  --color-text-disabled: #4d5166; /* 주석 전용 */
  --color-icon: #5c6075;
  /* 브랜드 블루 */
  --color-brand: #4353ff;
  --color-brand-alt: #5247ff;
  --color-brand-hover: #5566ff;   /* 가정 */
  --color-brand-active: #3544e6;  /* 가정 */
  --color-accent: #4f63ff;
  --color-accent-light: #6f7dff;
  --color-accent-lighter: #8f9bff;
  --color-badge-text: #9fa8ff;
  --color-badge-bg: #1a1f4d;
  --color-badge-bg-light: #1d2140;
  /* 그라데이션·워터마크 */
  --gradient-glow: radial-gradient(circle at 72% 42%, rgba(42,60,255,.55), rgba(42,60,255,0) 45%);
  --gradient-canvas: linear-gradient(135deg, #0b1030, #1a2a8a);
  --color-canvas-orb: rgba(51,70,255,.35);
  --color-watermark: rgba(255,255,255,.08);
  --color-watermark-strong: rgba(255,255,255,.18);
  /* 코드 */
  --color-code-tag: #e0a86a;
  --color-code-attr: #7fb0ff;
  --color-code-string: #9fd48a;
  --color-code-text: #d7d9e3;
  --color-code-comment: #4d5166;
  /* 상태색 (가정) */
  --color-error: #ff6b6b;   --color-error-bg: #2a1418;
  --color-warn: #f5b14c;    --color-warn-bg: #2a2214;
  --color-success: #4ade80; --color-success-bg: #11251a;
  --color-info: #8f9bff;    --color-info-bg: #1a1f4d;
  --color-focus: #6f7dff;
  /* 타이포 */
  --font-sans: Pretendard, 'Noto Sans KR', 'Malgun Gothic', sans-serif;
  --font-mono: Consolas, 'D2Coding', monospace;
  --fs-display: 66px; --fs-title: 19px; --fs-body-lg: 18px; --fs-btn-lg: 16px;
  --fs-md: 15px; --fs-step: 14px; --fs-sm: 13px; --fs-xs: 12px;
  --fs-caption: 11px; --fs-micro: 10px; --fs-badge: 9px;
  /* 간격 */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px;
  /* 반경 */
  --radius-xs: 3px; --radius-sm: 4px; --radius-md: 6px;
  --radius-lg: 8px; --radius-xl: 10px; --radius-pill: 999px;
}
body { background: var(--color-bg-page); color: var(--color-text); font-family: var(--font-sans); }
```

**컴포넌트 CSS 예시 (Primary 버튼)**

```css
.btn-primary {
  height: 46px; padding: 0 var(--space-6);
  background: var(--color-brand); color: var(--color-text-strong);
  border: 0; border-radius: var(--radius-sm);
  font-size: var(--fs-md); font-weight: 600; cursor: pointer;
  transition: background-color .15s;
}
.btn-primary:hover { background: var(--color-brand-hover); }
.btn-primary:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.btn-primary:disabled { background: var(--color-bg-control); color: var(--color-text-subtle); cursor: not-allowed; }
```

---

## 9. 확인 필요

### 9.1 SVG 근거 없이 `[가정]`으로 정한 항목

| # | 항목 | 정한 값 |
|---|---|---|
| A-1 | 상태색(오류·경고·성공·정보)과 배경 | 3.6절 |
| A-2 | Primary hover/active, Secondary·Outline hover, disabled 표현 | `#5566ff` / `#3544e6` 등, disabled는 bg `--color-bg-control` + 글자 `--color-text-subtle` |
| A-3 | 포커스 링 | 2px `#6f7dff`, offset 2px |
| A-4 | 다크 단일 테마 | 라이트 모드 없음 |
| A-5 | 웹폰트 로딩 | Pretendard CDN 한 줄 + 시스템 폰트 폴백 |
| A-6 | 반응형 브레이크포인트 | 768px 하나, 모바일 `display` 40px, 에디터 아이콘 바 숨김 |
| A-7 | 앱 헤더 높이 64, 우측 패널 폭 280, 입력 높이 36, 텍스트에리어 최소 96 | 목업은 축소 표현이라 앱 값은 별도 |
| A-8 | 토스트 위치·4초 소멸, 모달 오버레이·폭 | 6.12, 6.13 |
| A-9 | 비슷한 값 병합 `[통합]` | 텍스트 `#d7d9e3`/`#e6e7ee`, `#b9bccb`/`#c9cbd6`, `#8a8ea3`/`#9a9db0`, 반경 6/7, 패널 `#12141c`/`#12141d` 구분 유지 |
| A-10 | `badge` 9px | 앱에서 10px로 올릴지 |

### 9.2 와이어프레임·원칙과의 충돌·확인

| # | 내용 |
|---|---|
| C-1 | 구조 원칙 7.2는 전역 CSS가 `styles.css` 하나이고 정적 랜딩은 SPA 코드를 import하지 않는다(LY-13). 따라서 토큰 `:root` 블록을 `styles.css`와 `index.html`에 중복해서 두는데, 한쪽만 고치면 어긋난다. 허용할지, 랜딩이 `<link>`로 같은 CSS를 읽게 할지 결정 필요 |
| C-2 | WF-06 블록 선택은 와이어프레임에서 라디오 `(o)` 표기이고 SVG에는 라디오가 없다. 이 가이드는 선택 행 하이라이트(6.8)로 표현했다. 라디오 UI 유지 여부 확인 |
| C-3 | 시안 우측 에디터 목업의 USP 패널(WF-05)이 에디터 안에 떠 있는 형태인데, 와이어프레임 WF-05는 별도 화면이다. 목업은 스타일 참고로만 썼다 |
| C-4 | 시안의 카피·문구는 N-1 확인 필요 상태이므로 이 가이드는 문구를 확정하지 않는다 |
