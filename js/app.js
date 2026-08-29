/* =====================================================================
 * FocusOn — app.js  (프론트엔드)
 * 이 파일은 엔진 내부를 전혀 모릅니다. README 3번 "API 계약서"만 씁니다.
 *
 *   ?mock  → js/mock-engine.js  (카메라/모델 없이 UI 개발용)
 *   기본    → js/focus-engine.js (진짜 엔진)
 * ===================================================================== */

const USE_MOCK = new URLSearchParams(location.search).has('mock');
const { FocusEngine } = USE_MOCK
  ? await import('./mock-engine.js')
  : await import('./focus-engine.js');

/* ------------------------------------------------------------- 요소 */
const $ = (id) => document.getElementById(id);
const el = {
  video: $('cam'), overlay: $('overlay'), camHint: $('camHint'),
  calibBox: $('calibBox'), calibNum: $('calibNum'), calibBar: $('calibBar'),
  btnCalib: $('btnCalib'), btnStart: $('btnStart'), btnStop: $('btnStop'),
  status: $('status'), engineBadge: $('engineBadge'),
  ringFill: $('ringFill'), scoreNum: $('scoreNum'), stateChip: $('stateChip'),
  confFlash: $('confFlash'),
  barHead: $('barHead'), barGaze: $('barGaze'), barEyes: $('barEyes'),
  valHead: $('valHead'), valGaze: $('valGaze'), valEyes: $('valEyes'),
  mini: $('miniTimeline'), miniMeta: $('miniMeta'),
  report: $('report'), reportChart: $('reportChart'),
  kpiRatio: $('kpiRatio'), kpiDur: $('kpiDur'), kpiAvg: $('kpiAvg'), kpiConf: $('kpiConf'),
  segList: $('segList'), confList: $('confList'),
  btnJson: $('btnJson'), btnAgain: $('btnAgain'),
  confReview: $('confReview'), confGrid: $('confGrid'),
  parentEmail: $('parentEmail'), btnSendParentReport: $('btnSendParentReport'),
  parentReportStatus: $('parentReportStatus'),
  battleEntry: $('battleEntry'), btnBattleCreate: $('btnBattleCreate'),
  battleCodeInput: $('battleCodeInput'), btnBattleJoin: $('btnBattleJoin'),
  battleEntryStatus: $('battleEntryStatus'),
  battleRoom: $('battleRoom'), battleCodeDisplay: $('battleCodeDisplay'),
  battleWaiting: $('battleWaiting'), battleVs: $('battleVs'),
  battleMyScore: $('battleMyScore'), battleMyChip: $('battleMyChip'),
  battleOppScore: $('battleOppScore'), battleOppChip: $('battleOppChip'),
};

const STATE_KO = { focused: '집중', distracted: '딴짓', drowsy: '졸음', away: '자리 이탈', idle: '대기' };
const STATE_COLOR = { focused: '#5db872', distracted: '#d4a017', drowsy: '#c64545', away: '#6c6a64' };
const RING_LEN = 2 * Math.PI * 94;

if (USE_MOCK) {
  el.engineBadge.textContent = '엔진: MOCK (UI 개발용)';
  el.engineBadge.style.color = '#d4a017';
  el.engineBadge.style.borderColor = 'rgba(212,160,23,.4)';
  el.engineBadge.style.background = 'rgba(212,160,23,.08)';
}

/* ------------------------------------------------------------- 상태 */
const engine = new FocusEngine();
let recent = [];          // 미니 타임라인용 최근 60초 {t, score, state}
let recentConf = [];      // 최근 confusion t
let lastReport = null;

/* --------------------------------------------------------- 배틀룸 */
// 같은 origin이면 io()가 자동으로 현재 페이지를 서빙 중인 Node 서버에 연결됨
// (python -m http.server 같은 Node가 아닌 정적 서버로 열었다면 연결되지 않을 수 있음)
const socket = io();
let battleActive = false;

socket.on('connect_error', () => {
  // 백엔드(server/) 가 안 켜져 있어도 나머지 기능은 정상 동작해야 하므로 조용히 무시
});

el.btnBattleCreate.addEventListener('click', () => {
  el.battleEntryStatus.textContent = '';
  socket.emit('battle:create');
});

el.btnBattleJoin.addEventListener('click', () => {
  const code = (el.battleCodeInput.value || '').trim().toUpperCase();
  if (!code) { el.battleEntryStatus.textContent = '방 코드를 입력하세요.'; return; }
  el.battleEntryStatus.textContent = '';
  socket.emit('battle:join', { code });
});

socket.on('battle:created', ({ code }) => {
  battleActive = true;
  enterBattleRoom(code);
  el.battleWaiting.hidden = false;
  el.battleVs.hidden = true;
});

socket.on('battle:joined', ({ code }) => {
  battleActive = true;
  enterBattleRoom(code);
  // 참가자는 이미 상대방이 있는 방에 들어온 것이므로 바로 대결 화면 표시
  el.battleWaiting.hidden = true;
  el.battleVs.hidden = false;
});

socket.on('battle:opponent-joined', () => {
  el.battleWaiting.hidden = true;
  el.battleVs.hidden = false;
});

socket.on('battle:join-error', ({ reason }) => {
  el.battleEntryStatus.textContent = reason || '참가에 실패했습니다.';
});

socket.on('battle:opponent-score', ({ score, state }) => {
  el.battleOppScore.textContent = score;
  el.battleOppChip.dataset.state = state;
  el.battleOppChip.textContent = STATE_KO[state] || state;
});

socket.on('battle:opponent-left', () => {
  el.battleVs.hidden = true;
  el.battleWaiting.hidden = false;
  el.battleWaiting.textContent = '상대방이 방을 나갔습니다. 다른 사람이 참가할 때까지 기다려주세요.';
  el.battleOppScore.textContent = '--';
  el.battleOppChip.dataset.state = 'idle';
  el.battleOppChip.textContent = '대기';
});

function enterBattleRoom(code) {
  el.battleCodeDisplay.textContent = code;
  el.battleEntry.hidden = true;
  el.battleRoom.hidden = false;
}

/* ---------------------------------------------------------- 카메라 */
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    el.video.srcObject = stream;
    await el.video.play();
    el.camHint.hidden = true;
    return true;
  } catch (e) {
    console.warn('카메라 실패:', e);
    el.camHint.hidden = false;
    el.camHint.innerHTML = USE_MOCK
      ? 'MOCK 모드 — 카메라 없이 UI만 확인합니다.'
      : '카메라를 열 수 없습니다.<br>브라우저 권한을 확인하고, <b>http://localhost</b> 또는 <b>https</b> 로 접속했는지 확인하세요.';
    return false;
  }
}

/* --------------------------------------------------------- 엔진 배선 */
engine.on('status', ({ phase }) => {
  const msg = {
    loading: 'AI 모델 로딩 중… (최초 1회, 수 초 걸립니다)',
    ready: '준비 완료 — <b>측정 시작</b>을 누르세요.',
    calibrating: '보정 중 — 화면을 편하게 정면으로 바라보세요.',
    running: '측정 중…',
    stopped: '측정 종료 — 아래 리포트를 확인하세요.',
  }[phase];
  if (msg) el.status.innerHTML = msg;
  if (phase === 'stopped') { el.stateChip.dataset.state = 'idle'; el.stateChip.textContent = '대기'; }
});

engine.on('calibration', ({ progress, done }) => {
  el.calibBox.hidden = done;
  el.calibBar.style.width = (progress * 100).toFixed(1) + '%';
  el.calibNum.textContent = Math.max(0, Math.ceil(5 * (1 - progress)));
});

engine.on('score', ({ score, state, signals, t }) => {
  // 링 계기판
  el.ringFill.style.strokeDashoffset = String(RING_LEN * (1 - score / 100));
  el.scoreNum.textContent = score;
  // 상태 칩
  el.stateChip.dataset.state = state;
  el.stateChip.textContent = STATE_KO[state] || state;
  // 신호 막대
  setBar(el.barHead, el.valHead, signals.head);
  setBar(el.barGaze, el.valGaze, signals.gaze);
  setBar(el.barEyes, el.valEyes, signals.eyes);
  // 미니 타임라인
  recent.push({ t, score, state });
  const cutoff = t - 60000;
  while (recent.length && recent[0].t < cutoff) recent.shift();
  recentConf = recentConf.filter((c) => c >= cutoff);
  el.miniMeta.textContent = fmtTime(t);
  drawMini();
  // 배틀룸 활성화 시 내 점수를 상대에게 전송 + 내 쪽 UI 갱신
  if (battleActive) {
    socket.emit('battle:score', { score, state });
    el.battleMyScore.textContent = score;
    el.battleMyChip.dataset.state = state;
    el.battleMyChip.textContent = STATE_KO[state] || state;
  }
});

engine.on('confusion', ({ t }) => {
  recentConf.push(t);
  el.confFlash.classList.remove('on');
  void el.confFlash.offsetWidth;   // reflow → 애니메이션 재시작
  el.confFlash.classList.add('on');
  setTimeout(() => el.confFlash.classList.remove('on'), 1400);
});

engine.on('frame', ({ landmarks }) => drawOverlay(landmarks));

function setBar(bar, val, v) {
  const p = Math.round((v ?? 0) * 100);
  bar.style.width = p + '%';
  val.textContent = p + '%';
}

/* ------------------------------------------------------------ 버튼 */
el.btnCalib.addEventListener('click', async () => {
  el.btnCalib.disabled = true;
  try {
    el.status.innerHTML = 'AI 모델 로딩 중…';
    await engine.init();
    engine.attach(el.video);
    el.calibBox.hidden = false;
    await engine.calibrate(5);
    el.btnStart.disabled = false;
    el.status.innerHTML = '보정 완료 ✓ — <b>측정 시작</b>을 누르세요.';
  } catch (e) {
    console.error(e);
    el.status.innerHTML = '오류: ' + (e?.message || e);
  } finally {
    el.calibBox.hidden = true;
    el.btnCalib.disabled = false;
  }
});

el.btnStart.addEventListener('click', () => {
  recent = []; recentConf = []; lastReport = null;
  el.report.hidden = true;
  engine.start();
  el.btnStart.disabled = true;
  el.btnCalib.disabled = true;
  el.btnStop.disabled = false;
});

el.btnStop.addEventListener('click', () => {
  engine.stop();
  el.btnStop.disabled = true;
  el.btnStart.disabled = false;
  el.btnCalib.disabled = false;
  lastReport = engine.getReport();
  renderReport(lastReport);
});

el.btnAgain.addEventListener('click', () => { el.report.hidden = true; el.btnStart.click(); });

el.btnSendParentReport.addEventListener('click', async () => {
  const parentEmail = (el.parentEmail.value || '').trim();
  if (!parentEmail) { el.parentReportStatus.textContent = '학부모 이메일 주소를 입력하세요.'; return; }
  if (!lastReport) { el.parentReportStatus.textContent = '먼저 측정을 종료해서 리포트를 만들어주세요.'; return; }

  const summary = {
    focusRatio: lastReport.focusRatio,
    durationSec: lastReport.durationSec,
    avgScore: lastReport.avgScore,
    confusionCount: lastReport.events.length,
  };

  el.btnSendParentReport.disabled = true;
  el.parentReportStatus.textContent = '전송 중…';
  try {
    const res = await fetch('/api/parent-report/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentEmail, summary }),
    });
    const data = await res.json();
    el.parentReportStatus.textContent = data.note || '알 수 없는 응답입니다.';
  } catch (e) {
    el.parentReportStatus.textContent = '백엔드 서버에 연결할 수 없습니다. server 폴더에서 npm start 로 서버를 실행한 뒤 다시 시도하세요.';
  } finally {
    el.btnSendParentReport.disabled = false;
  }
});

el.btnJson.addEventListener('click', () => {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `focuson-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ------------------------------------------------------- 랜드마크 */
function drawOverlay(landmarks) {
  const c = el.overlay;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  ctx.fillStyle = 'rgba(93,184,166,.75)';
  for (let i = 0; i < landmarks.length; i += 4) {
    const p = landmarks[i];
    ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
  }
}

/* ------------------------------------------------------ 미니 차트 */
function drawMini() {
  const c = el.mini;
  const w = c.clientWidth, h = 90;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (recent.length < 2) return;

  const t0 = recent[0].t, t1 = Math.max(recent[recent.length - 1].t, t0 + 1);
  const X = (t) => ((t - t0) / (t1 - t0)) * w;
  const Y = (s) => h - 6 - (s / 100) * (h - 12);

  // 기준선 (집중 임계선 66점)
  ctx.strokeStyle = 'rgba(20,20,19,.12)';
  ctx.setLineDash([3, 4]); ctx.beginPath();
  ctx.moveTo(0, Y(66)); ctx.lineTo(w, Y(66)); ctx.stroke(); ctx.setLineDash([]);

  // 면적
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(93,184,166,.28)');
  grad.addColorStop(1, 'rgba(93,184,166,0)');
  ctx.beginPath();
  ctx.moveTo(X(recent[0].t), h);
  for (const r of recent) ctx.lineTo(X(r.t), Y(r.score));
  ctx.lineTo(X(recent[recent.length - 1].t), h);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  // 선
  ctx.beginPath();
  recent.forEach((r, i) => (i ? ctx.lineTo(X(r.t), Y(r.score)) : ctx.moveTo(X(r.t), Y(r.score))));
  ctx.strokeStyle = '#5db8a6'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  // 막힌 지점 마커
  ctx.fillStyle = '#141413';
  for (const t of recentConf) {
    ctx.beginPath(); ctx.arc(X(t), 8, 3, 0, Math.PI * 2); ctx.fill();
  }
}

/* --------------------------------------------------------- 리포트 */
function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function renderReport(rep) {
  el.kpiRatio.textContent = Math.round(rep.focusRatio * 100) + '%';
  el.kpiDur.textContent = fmtTime(rep.durationSec * 1000);
  el.kpiAvg.textContent = rep.avgScore ?? '–';
  el.kpiConf.textContent = rep.events.length + '회';

  // 구간 리스트
  el.segList.innerHTML = '';
  if (!rep.segments.length) {
    el.segList.innerHTML = '<li class="empty">없음 — 훌륭합니다!</li>';
  } else {
    for (const s of rep.segments) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="tag ${s.type}">${STATE_KO[s.type]}</span>
        <span>${fmtTime(s.startT)} → ${fmtTime(s.endT)}</span>
        <span style="margin-left:auto;color:var(--tx3)">${Math.round((s.endT - s.startT) / 1000)}초</span>`;
      el.segList.appendChild(li);
    }
  }

  // 막힌 지점 리스트
  el.confList.innerHTML = '';
  if (!rep.events.length) {
    el.confList.innerHTML = '<li class="empty">감지된 지점 없음</li>';
  } else {
    for (const e of rep.events) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="tag conf">막힘</span><span>${fmtTime(e.t)} 지점</span>
        <span style="margin-left:auto;color:var(--tx3)">이 부분 다시 보기</span>`;
      el.confList.appendChild(li);
    }
  }

  el.report.hidden = false;
  drawReportChart(rep);
  renderConfusionReview(rep);
  el.report.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderConfusionReview(rep) {
  el.confGrid.innerHTML = '';
  if (!rep.events.length) { el.confReview.hidden = true; return; }
  el.confReview.hidden = false;
  rep.events.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = 'confcard';
    card.innerHTML = `
      <div class="confthumb">영상 미리보기 없음</div>
      <div class="conftime">${fmtTime(e.t)}</div>
      <div class="conflabel">막힌 지점 ${i + 1} · 이 시점 전후 30초를 다시 확인해보세요</div>`;
    el.confGrid.appendChild(card);
  });
}

function drawReportChart(rep) {
  const c = el.reportChart;
  const w = c.clientWidth, h = 220;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const tl = rep.timeline;
  if (tl.length < 2) {
    ctx.fillStyle = '#6c6a64'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('데이터가 너무 짧습니다', w / 2, h / 2);
    return;
  }
  const pad = { l: 34, r: 12, t: 14, b: 24 };
  const t0 = tl[0].t, t1 = Math.max(tl[tl.length - 1].t, t0 + 1);
  const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const Y = (s) => pad.t + (1 - s / 100) * (h - pad.t - pad.b);

  // 흐트러진 구간 배경 밴드
  for (const s of rep.segments) {
    ctx.fillStyle = STATE_COLOR[s.type] + '22';
    ctx.fillRect(X(s.startT), pad.t, Math.max(2, X(s.endT) - X(s.startT)), h - pad.t - pad.b);
  }

  // 격자 + y축
  ctx.strokeStyle = 'rgba(20,20,19,.08)'; ctx.lineWidth = 1;
  ctx.fillStyle = '#6c6a64'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
  for (const v of [0, 25, 50, 75, 100]) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(String(v), pad.l - 6, Y(v) + 4);
  }

  // x축 라벨
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    ctx.fillText(fmtTime(t), X(t), h - 7);
  }

  // 곡선
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, 'rgba(93,184,166,.28)');
  grad.addColorStop(1, 'rgba(93,184,166,0)');
  ctx.beginPath();
  ctx.moveTo(X(tl[0].t), h - pad.b);
  for (const p of tl) ctx.lineTo(X(p.t), Y(p.score));
  ctx.lineTo(X(tl[tl.length - 1].t), h - pad.b);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  tl.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.score)) : ctx.moveTo(X(p.t), Y(p.score))));
  ctx.strokeStyle = '#5db8a6'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();

  // 막힌 지점 마커
  for (const e of rep.events) {
    ctx.strokeStyle = 'rgba(20,20,19,.35)'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(e.t), pad.t); ctx.lineTo(X(e.t), h - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#141413';
    ctx.beginPath(); ctx.arc(X(e.t), pad.t + 2, 4, 0, Math.PI * 2); ctx.fill();
  }
}

window.addEventListener('resize', () => {
  drawMini();
  if (lastReport) drawReportChart(lastReport);
});

/* --------------------------------------------------------- 시작! */
await initCamera();
// 디버깅용: 콘솔에서 engine 을 직접 만져볼 수 있게
window.engine = engine;
