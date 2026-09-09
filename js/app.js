/* =====================================================================
 * FocusOn — app.js  (프론트엔드)
 * 이 파일은 엔진 내부를 전혀 모릅니다. README 3번 "API 계약서"만 씁니다.
 *
 *   ?mock  → js/mock-engine.js  (카메라/모델 없이 UI 개발용)
 *   기본    → js/focus-engine.js (진짜 엔진)
 * ===================================================================== */

import { el } from './ui/dom.js';
import { STATE_KO, C, withAlpha } from './ui/theme.js';
import { UI, RING_LEN, applyUiText, fmtTime } from './ui/display.js';
import { drawOverlay, drawMini, drawReportChart } from './ui/charts.js';
import { renderReport } from './ui/report.js';
import { reportScore } from './ui/battle.js';

const USE_MOCK = new URLSearchParams(location.search).has('mock');
const { FocusEngine } = USE_MOCK
  ? await import('./mock-engine.js')
  : await import('./focus-engine.js');

applyUiText();

if (USE_MOCK) {
  el.engineBadge.textContent = '엔진: MOCK (UI 개발용)';
  el.engineBadge.style.color = C.warning;
  el.engineBadge.style.borderColor = withAlpha(C.warning, 0.4);
  el.engineBadge.style.background = withAlpha(C.warning, 0.08);
}

/* ------------------------------------------------------------- 상태 */
const engine = new FocusEngine();
let recent = [];          // 미니 타임라인용 최근 구간 버퍼 {t, score, state}
let recentConf = [];      // 최근 confusion t
let lastReport = null;

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
  el.calibNum.textContent = Math.max(0, Math.ceil(UI.calibSec * (1 - progress)));
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
  const cutoff = t - UI.recentWindowSec * 1000;
  while (recent.length && recent[0].t < cutoff) recent.shift();
  recentConf = recentConf.filter((c) => c >= cutoff);
  el.miniMeta.textContent = fmtTime(t);
  drawMini(recent, recentConf);
  // 배틀룸이 켜져 있으면 점수를 상대에게 (꺼져 있으면 아무 일도 안 함)
  reportScore(score, state);
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
    await engine.calibrate(UI.calibSec);
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

window.addEventListener('resize', () => {
  drawMini(recent, recentConf);
  if (lastReport) drawReportChart(lastReport);
});

/* --------------------------------------------------------- 시작! */
await initCamera();
// 디버깅용: 콘솔에서 engine 을 직접 만져볼 수 있게
window.engine = engine;
