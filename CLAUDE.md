# CLAUDE.md — FocusOn 작업 기준

이 파일이 판단의 기준점이다. 세션이 길어져 판단이 흔들릴 때, 새 사람이 합류할 때,
심사에서 "왜 이렇게 했나"를 물을 때 이 문서를 먼저 본다.

FocusOn은 웹캠으로 학습자의 집중도를 실시간 측정하고 학습 리포트를 만드는 도구다.
L.E.A.P 2026 출품작. 얼굴 분석은 전부 브라우저 안에서(MediaPipe Face Landmarker) 수행된다.

---

## 1. 절대 원칙

### ① 영상은 기기 밖으로 나가지 않는다
카메라 프레임과 468점 랜드마크는 `js/focus-engine.js` 안에서만 존재한다.
네트워크로 나갈 수 있는 것은 **점수(0~100)와 상태 문자열**뿐이다.
프레임·랜드마크·썸네일을 서버로 보내는 코드는 어떤 이유로도 추가하지 않는다.
이 원칙이 제품의 정체성이고, 깨지는 순간 "온디바이스"라는 주장 전체가 무너진다.

### ② 화면 문구는 실제 동작과 일치해야 한다
"온디바이스 · 영상은 기기 밖으로 나가지 않습니다" 같은 문구는 **검증 가능한 주장**이다.
기능이 바뀌면 문구를 먼저 고친다. 사실과 다른 문구를 남겨두는 것은 기능 미완성보다 나쁘다.
심사·시연에서 가장 먼저 무너지는 지점이다.

### ③ 백엔드가 없어도 앱은 완전히 동작한다
측정·리포트는 서버 없이 완결된다. 서버 의존 기능(배틀룸, 학부모 리포트 발송)은
**소켓이 실제로 연결됐을 때만** 화면에 나타난다.
서버 부재가 측정 기능을 막거나, 눌러도 반응 없는 버튼을 남겨서는 안 된다.

### ④ 엔진과 화면은 API 계약으로만 대화한다
`js/app.js`는 엔진 내부를 모른다. `README.md` 3절의 계약(`init/attach/calibrate/start/stop/on/getReport`)만 쓴다.
`focus-engine.js`(진짜)와 `mock-engine.js`(가짜)는 **동일한 계약**을 지킨다.
그래서 `?mock` 한 줄로 카메라·모델 없이 UI 전체를 시연할 수 있다. 이 성질을 잃지 않는다.

### ⑤ 한 번에 하나만 바꾸고 커밋한다
여러 개를 고치고 한 번에 커밋하면 무엇이 깨뜨렸는지 못 찾는다.
커밋 메시지에는 **무엇을 왜 고쳤는지**를 쓴다. 되돌릴 지점이 곧 안전망이다.

---

## 2. 금지 사항

**하드코딩 금지**
- 화면에 보이는 수치(보정 초, 임계 점수, 방 코드 자릿수, 타임라인 길이)는 **소스가 하나여야 한다.**
  HTML 텍스트와 JS 상수에 같은 숫자를 따로 적지 않는다.
- `js/app.js`에서 hex 색상을 직접 쓰지 않는다. 색은 `css/style.css`의 `:root` 변수가 유일한 출처다.
  캔버스에서 필요하면 `getComputedStyle`로 읽어온다.
- 데이터에 없는 값을 그럴듯하게 채우지 않는다. 없으면 렌더하지 않는다.

**보안·개인정보 금지**
- 비밀키는 서버 전용. 클라이언트에 노출되는 접두사(`NEXT_PUBLIC_` 등)를 쓰지 않는다.
- `.env`, `server/certs/` 를 커밋하지 않는다. (`.gitignore`에 등록돼 있다)
- **사용자 입력(이메일 주소 등)을 로그·응답에 남기지 않는다.**
  외부 서비스의 오류 봉투(status/message)만 전달한다.
- `server.js`의 정적 서빙은 **허용 목록 방식**을 유지한다. 루트를 통째로 서빙하면
  `server/certs/key.pem`, `server/node_modules/**`, `CLAUDE.md` 가 공개된다.
  현재 허용은 `/css`, `/js`, `/index.html` 뿐이다. 이 목록을 함부로 넓히지 않는다.

**구조 금지**
- 빌드 단계를 만들지 않는다. 순수 ES 모듈 + 정적 파일 구조를 유지한다.
  (번들러·프레임워크 도입은 배포·디버깅 난이도를 한 단계 올린다)
- npm 패키지를 프론트엔드에 추가하지 않는다. 필요하면 CDN 또는 로컬 파일로.
- **저장소를 GitHub Organization으로 이전하지 않는다.**
  Vercel Hobby 플랜은 Organization 소유 저장소에 연결할 수 없다. 팀원은 Collaborator로 초대한다.

---

## 3. 기술 스택 (변경 금지)

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트 | 순수 HTML/CSS/JS (ES 모듈) | 빌드 없음 → 배포 실패 요인 제거, 디버깅 단순 |
| 얼굴 인식 | MediaPipe Face Landmarker (tasks-vision 0.10.14) | 블렌드셰이프·변환행렬을 바로 받아 EAR/각도 직접 계산 불필요 |
| 판정 로직 | 규칙 기반 (CNN 학습 없음) | 학습 데이터 없이 재현 가능, 근거를 설명할 수 있음 |
| 백엔드 | Express + Socket.io (로컬 전용) | 배틀룸 실시간 relay. 메모리 Map, DB 없음 |
| 배포 | Vercel 정적 | `server/`는 `.vercelignore`로 제외 |

**Vercel에 백엔드를 올리려 하지 않는다.** 서버리스 함수는 WebSocket 상시 연결을 유지하지 못해
socket.io가 동작하지 않는다. 배틀룸이 필요하면 Render/Railway 같은 상시 서버를 별도로 쓴다.

---

## 4. 파일 구조

```
focuson/
├─ index.html            화면 뼈대
├─ css/style.css         디자인 토큰(:root) + 레이아웃. 색의 유일한 출처
├─ js/
│  ├─ app.js             프론트. 엔진 배선 + 배틀룸 소켓 + 캔버스 차트 + 리포트 렌더
│  ├─ focus-engine.js    ★ 진짜 엔진. 설정은 상단 DEFAULT_CONFIG 한 곳
│  └─ mock-engine.js     같은 계약의 가짜 엔진 (?mock)
├─ server/               로컬 전용. Vercel 배포에서 제외됨
│  ├─ server.js          정적 서빙 + 배틀룸 + 학부모 리포트(모의)
│  └─ scripts/gen-cert.js  로컬 HTTPS 인증서 생성
├─ README.md             API 계약서 + 실행법
├─ CLAUDE.md             이 문서
├─ vercel.json           빌드 없는 정적 서빙 명시
└─ .vercelignore         server/ 제외 (개인키 노출 차단)
```

**튜닝은 `focus-engine.js` 상단 `DEFAULT_CONFIG`만 만진다.**
순서 제안: `head.deadzoneDeg` → `thresholds.distracted` → `confusion.level`

---

## 5. 알려진 함정

| 증상 | 원인 / 대응 |
|---|---|
| `hidden` 속성을 줬는데 안 숨겨짐 | 요소에 `display:flex` 등이 지정돼 있으면 브라우저 기본 `[hidden]{display:none}`을 이긴다. `css/style.css` 상단의 `[hidden]{display:none!important}` 전역 규칙이 이를 막는다 |
| 배포본 콘솔이 `/socket.io/` 404로 뒤덮임 | socket.io 기본값이 무한 재시도. `io({reconnectionAttempts:3})`으로 제한했고, 한 번 연결되면 무한 재시도로 되돌린다 |
| VS Code 커밋 시 `index.lock: File exists` | 프로젝트가 OneDrive 안에 있어 동기화가 git 잠금파일을 붙든다. OneDrive 동기화 일시 중지 후 재시도. **근본 해결: 폴더를 OneDrive 밖으로 이동** |
| 대회장에서 앱이 아예 안 뜸 | 외부 CDN 3곳 의존(socket.io, MediaPipe WASM, 모델 파일). 오프라인 대비는 5절 미해결 항목 참조 |
| 카메라가 안 열림 | `https` 또는 `localhost`에서만 허용된다. 같은 Wi-Fi의 다른 기기는 `npm run gen-cert` 후 HTTPS 포트로 접속 |
| 심사위원이 링크를 못 엶 | 프리뷰 URL은 Vercel 로그인을 요구할 수 있다. **프로덕션 URL을 전달**하고 시크릿 창으로 확인 |
| `npm start` 했는데 서버가 안 뜨고 `ERR_OSSL_UNSUPPORTED` | `server/certs/` 의 인증서가 깨졌거나 일부만 있다. `https.createServer` 가 try/catch 없이 호출돼 **HTTP 서버까지 같이 죽는다.** `npm run gen-cert` 로 재생성 |
| `npm start` 가 30초 넘게 걸림 | `server/node_modules` 가 OneDrive 안에 있어 파일 읽기가 느리다. OneDrive 밖으로 옮기면 해소 |

---

## 6. 미해결 — 다음에 손댈 것 (아픈 순서)

**해결됨**: 정적 서빙 루트 노출 · 화면 문구 부정확 · 하드코딩 이중 관리 6건 ·
`hidden` 무력화 · socket.io 무한 재시도 · 백엔드 없을 때 앱 중단

1. **학부모 이메일이 서버 콘솔에 평문 기록** (`server/server.js`)
   → 개인정보. "사용자 입력을 로그에 남기지 않는다" 원칙 위반.
2. **인증서가 깨지면 서버 전체가 부팅 실패**
   → `https.createServer` 를 try/catch 로 감싸고, 실패 시 HTTP만으로 계속 뜨게.
3. **소켓 CORS `origin:'*'`** → 서버를 실제 배포할 때 origin 제한.
4. **`js/app.js` 의 hex 색상 중복** → `css/style.css` 의 CSS 변수를 읽어 쓰도록.
5. **`js/app.js` 474줄 분리** → 소켓/차트/리포트를 별 파일로. 여유 있을 때만.

### 보류 결정 (되돌릴 때 근거가 필요해서 남김)

- **CDN 오프라인 대비 (모델·WASM 로컬화)** — 하지 않기로 함.
  모델 파일 약 4MB를 레포에 넣으면 방문당 전송량이 17KB → 4MB로 늘고,
  Vercel 무료 한도는 **프로젝트별이 아니라 계정 전체 공유**라 다른 프로젝트 몫까지 잠식한다.
  대신 발표 전 대비: 발표용 노트북에서 미리 한 번 열어두기 + 휴대폰 핫스팟 준비.
