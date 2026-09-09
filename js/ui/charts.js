/* =====================================================================
 * FocusOn — ui/charts.js
 * 캔버스 그리기. 미리보기 랜드마크 · 미니 타임라인 · 리포트 그래프.
 * ===================================================================== */

import { el } from './dom.js';
import { C, withAlpha, STATE_COLOR } from './theme.js';
import { fmtTime } from './display.js';
import { THRESHOLDS } from '../engine-contract.js';

/* ------------------------------------------------------- 랜드마크 */
export function drawOverlay(landmarks) {
  const c = el.overlay;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  ctx.fillStyle = withAlpha(C.teal, 0.75);
  for (let i = 0; i < landmarks.length; i += 4) {
    const p = landmarks[i];
    ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
  }
}

/* ------------------------------------------------------ 미니 차트 */
export function drawMini(recent, recentConf) {
  const c = el.mini;
  const w = c.clientWidth, h = 90;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (recent.length < 2) return;

  const t0 = recent[0].t, t1 = Math.max(recent[recent.length - 1].t, t0 + 1);
  const X = (t) => ((t - t0) / (t1 - t0)) * w;
  const Y = (s) => h - 6 - (s / 100) * (h - 12);

  // 기준선 (집중 임계선 — 엔진과 같은 값을 쓴다)
  ctx.strokeStyle = withAlpha(C.ink, 0.12);
  ctx.setLineDash([3, 4]); ctx.beginPath();
  ctx.moveTo(0, Y(THRESHOLDS.focused)); ctx.lineTo(w, Y(THRESHOLDS.focused)); ctx.stroke(); ctx.setLineDash([]);

  // 면적
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, withAlpha(C.teal, 0.28));
  grad.addColorStop(1, withAlpha(C.teal, 0));
  ctx.beginPath();
  ctx.moveTo(X(recent[0].t), h);
  for (const r of recent) ctx.lineTo(X(r.t), Y(r.score));
  ctx.lineTo(X(recent[recent.length - 1].t), h);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  // 선
  ctx.beginPath();
  recent.forEach((r, i) => (i ? ctx.lineTo(X(r.t), Y(r.score)) : ctx.moveTo(X(r.t), Y(r.score))));
  ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  // 막힌 지점 마커
  ctx.fillStyle = C.ink;
  for (const t of recentConf) {
    ctx.beginPath(); ctx.arc(X(t), 8, 3, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawReportChart(rep) {
  const c = el.reportChart;
  const w = c.clientWidth, h = 220;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const tl = rep.timeline;
  if (tl.length < 2) {
    ctx.fillStyle = C.muted; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('데이터가 너무 짧습니다', w / 2, h / 2);
    return;
  }
  const pad = { l: 34, r: 12, t: 14, b: 24 };
  const t0 = tl[0].t, t1 = Math.max(tl[tl.length - 1].t, t0 + 1);
  const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const Y = (s) => pad.t + (1 - s / 100) * (h - pad.t - pad.b);

  // 흐트러진 구간 배경 밴드
  for (const s of rep.segments) {
    ctx.fillStyle = withAlpha(STATE_COLOR[s.type], 0.13);
    ctx.fillRect(X(s.startT), pad.t, Math.max(2, X(s.endT) - X(s.startT)), h - pad.t - pad.b);
  }

  // 격자 + y축
  ctx.strokeStyle = withAlpha(C.ink, 0.08); ctx.lineWidth = 1;
  ctx.fillStyle = C.muted; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
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
  grad.addColorStop(0, withAlpha(C.teal, 0.28));
  grad.addColorStop(1, withAlpha(C.teal, 0));
  ctx.beginPath();
  ctx.moveTo(X(tl[0].t), h - pad.b);
  for (const p of tl) ctx.lineTo(X(p.t), Y(p.score));
  ctx.lineTo(X(tl[tl.length - 1].t), h - pad.b);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  tl.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.score)) : ctx.moveTo(X(p.t), Y(p.score))));
  ctx.strokeStyle = C.teal; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();

  // 막힌 지점 마커
  for (const e of rep.events) {
    ctx.strokeStyle = withAlpha(C.ink, 0.35); ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(X(e.t), pad.t); ctx.lineTo(X(e.t), h - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(X(e.t), pad.t + 2, 4, 0, Math.PI * 2); ctx.fill();
  }
}
