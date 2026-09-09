# FocusOn — AI 얼굴인식 실시간 집중도 측정 학습 도우미

L.E.A.P 2026 · 얼굴 분석은 전부 **브라우저 안에서**(MediaPipe) 수행됩니다.
**카메라 영상과 얼굴 랜드마크는 어떤 경우에도 기기 밖으로 나가지 않습니다.**

### 네트워크로 나가는 것 — 전부 여기 적습니다

| 무엇이 | 어디로 | 언제 |
|---|---|---|
| MediaPipe 모델 · WASM 다운로드 | jsDelivr, Google 스토리지 | 최초 1회 |
| 집중도 점수(0~100) + 상태 문자열 | 우리 서버 (배틀룸 relay) | 배틀룸 사용 중에만 |
| 학부모 이메일 주소 + 리포트 요약 4개 값 | 우리 서버 | 발송 버튼을 눌렀을 때만 |

**영상 프레임과 468점 얼굴 랜드마크는 이 목록에 없습니다.** `js/focus-engine.js` 밖으로 나가지 않습니다.

배틀룸과 학부모 발송은 로컬에서 `server/` 를 띄웠을 때만 동작합니다.
Vercel 정적 배포본에는 백엔드가 없으므로 이 두 기능이 화면에 아예 나타나지 않습니다.

---

## 1. 파일 구조

```
focuson/
├─ index.html          ← 프론트
├─ css/style.css       ← 디자인
├─ js/focus-engine.js  ← ★ AI 엔진 = 우리 API (캡처+엔진)
├─ js/mock-engine.js   ← 같은 계약의 가짜 엔진 (프론트 병렬화용)
├─ js/engine-contract.js ← 엔진과 화면이 공유하는 값
├─ js/app.js           ← 프론트 (엔진을 '호출'만 함)
├─ js/ui/              ← 화면 조각들 (dom · theme · display · charts · report · battle)
├─ server/             ← 로컬 전용 백엔드 (배틀룸 + 학부모 발송). 배포에서 제외됨
│  ├─ server.js
│  └─ scripts/gen-cert.js  ← 로컬 HTTPS 인증서 생성
├─ vercel.json         ← 빌드 없는 정적 서빙 설정
├─ .vercelignore       ← server/·내부 문서를 배포에서 제외
├─ CLAUDE.md           ← 작업 기준(원칙·금지사항·미해결 항목)
└─ README.md           ← 이 문서 = 계약서
```

---

## 2. 실행 방법 (⚠️ 더블클릭하면 안 됩니다)

ES 모듈 + WASM이라 `file://` 로 열면 동작하지 않습니다. 반드시 로컬 서버로:

```bash
cd focuson
python -m http.server 8000
# → http://localhost:8000  로 접속
```

또는 VS Code **Live Server** 확장.

* 카메라는 **https 또는 localhost** 에서만 허용됩니다.
* 배포는 GitHub Pages(https)면 그대로 동작합니다.

### 모드 전환 (한 줄도 안 고칩니다)

| URL | 동작 |
|---|---|
| `http://localhost:8000/` | **진짜 엔진** (MediaPipe + 카메라) |
| `http://localhost:8000/?mock` | **MOCK 엔진** — 카메라·모델 없이 UI만. 프론트 담당 전용 |

---

## 3. ★ API 계약서 (이것만 지키면 각자 자유)

```js
const engine = new FocusEngine(config);   // config 생략 가능

await engine.init();            // MediaPipe 모델 로드 (한 번)
engine.attach(videoEl);         // 분석할 <video> 연결
await engine.calibrate(5);      // 5초 기준선(baseline) 측정 → 끝나면 resolve
engine.start();                 // 실시간 측정 시작
engine.stop();                  // 측정 종료

// 실시간 결과 (초당 여러 번 호출됨, 기본 약 20Hz)
engine.on('score', ({ score, state, signals, t }) => { ... });
//   score   : 0~100  집중 점수 (약 1초 이동평균으로 안정화된 값)
//   state   : 'focused' | 'distracted' | 'drowsy' | 'away'
//   signals : { head, gaze, eyes }  각 0~1  (UI 막대바용)
//   t       : 세션 시작 후 경과 ms

engine.on('confusion', ({ t }) => { ... });   // '막힌 지점' 순간
engine.on('status', ({ phase }) => { ... });  // 'loading'|'ready'|'calibrating'|'running'|'stopped'

// 종료 후 리포트
const report = engine.getReport();
//   { durationSec, focusRatio,           // 실집중률 (0~1)
//     avgScore,                          // 평균 집중도 (0~100)
//     timeline: [{t, score}, ...],       // 그래프용 (약 2Hz)
//     segments: [{type, startT, endT}],  // 졸음/이탈/딴짓 구간
//     events:   [{type:'confusion', t}] }
```

### 계약 보충 (헷갈리기 쉬운 3가지 — 여기서 합의하고 갑니다)

1. **`signals` 는 "좋을수록 1"** 입니다. `head:1` = 보정 기준선과 똑같은 자세, `head:0` = 완전히 벗어남.
   → UI 막대는 **가득 찰수록 좋음**. (편차값이 아닙니다.)
2. `status` 의 `phase` 에 계약서 원안에 없던 **`'ready'`** 가 하나 더 있습니다. 모델 로드 완료/보정 완료 시점입니다.
3. **추가 이벤트 2개** (계약을 깨지 않는 확장, 안 써도 됩니다)
   * `engine.on('frame', ({ landmarks, present }) => {})` — 얼굴 랜드마크 468점(정규화 좌표). 미리보기 위에 점 찍는 용도.
   * `engine.on('calibration', ({ progress, done, facePresent }) => {})` — 보정 진행률 0~1.

### 진짜 ↔ 가짜 엔진 교체는 이 한 줄

```js
// js/app.js 상단
const { FocusEngine } = USE_MOCK
  ? await import('./mock-engine.js')
  : await import('./focus-engine.js');
```

---

## 4. 엔진 내부 로직 (규칙 기반 — CNN 학습 없음)

MediaPipe Face Landmarker 를 `outputFaceBlendshapes` + `outputFacialTransformationMatrixes`
옵션으로 켜서, EAR·각도를 직접 계산하지 않고 필요한 수치를 바로 받습니다.

| 신호 | 출처 |
|---|---|
| 머리 자세 | 4×4 변환 행렬 → pitch / yaw / roll 분해 |
| 시선 | `eyeLookIn/Out/Up/Down` 블렌드셰이프 |
| 졸음 | `eyeBlinkLeft/Right` (감김 정도) + PERCLOS(최근 10초 감긴 비율) |
| 혼란(막힌 지점) | `browDownLeft/Right`, `browInnerUp` |
| 자리 이탈 | 얼굴 검출 실패 |

**처리 흐름 4단계**

1. **특징 추출** — 매 프레임 위 수치를 뽑음
2. **캘리브레이션** — 시작 5초의 **중앙값**을 그 사람의 정면 기준값으로 저장
   (평균이 아니라 중앙값 → 순간적으로 튄 프레임에 강함)
3. **점수 융합** — 100점에서 시작해 감점
   `score = 100 − (40·머리이탈 + 35·시선이탈 + 45·눈감김)`
   각 이탈값은 `(기준선 대비 편차 − deadzone) / range` 를 0~1 로 자른 값
4. **시계열 안정화 + 상태머신** — 시상수 0.8초 EMA로 튐 제거,
   상태는 후보가 **일정 시간 유지돼야** 전환 (집중 1.0s / 딴짓 1.2s / 이탈 1.2s / 졸음 1.5s)
   → 눈 한 번 깜빡였다고 '졸음'이 되지 않습니다.

동시에 **2Hz로 로그**를 쌓아 종료 시 리포트(실집중률·타임라인·구간·막힌 지점)를 만듭니다.

### 튜닝은 여기만 만지면 됩니다

`js/focus-engine.js` 상단의 `DEFAULT_CONFIG`, 또는 생성자에 덮어쓰기:

```js
const engine = new FocusEngine({
  weights: { head: 40, gaze: 35, eyes: 45 },   // 감점 가중치
  head: { deadzoneDeg: 8, rangeDeg: 28 },      // 고개 허용 각도
  thresholds: { focused: 66, distracted: 54 }, // 상태 경계
  confusion: { level: 0.20, holdMs: 600 },     // 막힌 지점 민감도
});
```

**내일 오전 튜닝 순서 제안**: ① `head.deadzoneDeg` (사람마다 자세 편차) → ② `thresholds.distracted`
(딴짓이 너무 자주/드물게 뜨면) → ③ `confusion.level` (막힌 지점이 안 잡히면 0.15로 낮추기).

---

## 5. 6인 분담 (계약서 확정 → 병렬 → 통합)

| 담당 | 파일 | 할 일 |
|---|---|---|
| 개발 A (캡처) | `focus-engine.js` 의 `init/attach/calibrate/_extract` | video → 원시 수치 |
| 개발 B (엔진) | `focus-engine.js` 의 `_tick` 이하 | 수치 → 점수·상태·리포트 |
| 개발 C (프론트, 정우성) | `index.html`, `app.js` | `?mock` 으로 UI 완성 → 나중에 자동 교체 |
| 디자인 | `css/style.css` + 목업 슬라이드 | 배틀룸·학부모 리포트 화면 |
| 리서치 | — | DAiSEE·MediaPipe 수치 원출처 검증, 학생 5~10명 사용 테스트 |
| 통합 | — | A+B 합류 → C는 `?mock` 떼기만 하면 끝 |

---

## 6. 만든 것 / 안 만든 것

이 절은 실제 코드 기준입니다. 초안에는 "전부 목업"이라 적혀 있었지만 이후 일부가 실제로 구현됐습니다.

| | 상태 |
|---|---|
| 배틀룸 실시간 대결 | **동작함** — Socket.io relay, 메모리 Map (서버 재시작 시 방 소멸) |
| 학부모 리포트 발송 | **로직만** — 서버가 콘솔에 찍기만 하고 실제 이메일은 안 나감 |
| 그룹, 로그인, DB | 없음 |
| 막힌 지점 영상 미리보기 | 없음 (시각만 표시) |

판별 질문: **"이게 측정 엔진을 더 정확·유용하게 하나?"** 아니면 뺍니다.

---

## 7. 발표 중 사고 대비 (2분이면 끝나는 보험)

* **인터넷이 끊기면** 모델 로드가 실패합니다. 대회장 와이파이를 믿기 어렵다면
  `face_landmarker.task` 와 `wasm/` 폴더를 미리 받아 레포에 넣고
  `DEFAULT_CONFIG` 의 `modelUrl`, `wasmUrl` 을 로컬 경로로 바꿔두세요.
* **카메라가 안 열리면** 발표는 `?mock` 으로 계속 진행할 수 있습니다. (화면·리포트 전부 동일)
* 배포 후 반드시 **다른 노트북 + 다른 네트워크**에서 한 번 열어보고 오세요.
