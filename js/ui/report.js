/* =====================================================================
 * FocusOn — ui/report.js
 * 측정 종료 후 학습 리포트 렌더링.
 * ===================================================================== */

import { el } from './dom.js';
import { STATE_KO } from './theme.js';
import { UI, fmtTime } from './display.js';
import { drawReportChart } from './charts.js';

export function renderReport(rep) {
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

export function renderConfusionReview(rep) {
  el.confGrid.innerHTML = '';
  if (!rep.events.length) { el.confReview.hidden = true; return; }
  el.confReview.hidden = false;
  rep.events.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = 'confcard';
    card.innerHTML = `
      <div class="confthumb">영상 미리보기 없음</div>
      <div class="conftime">${fmtTime(e.t)}</div>
      <div class="conflabel">막힌 지점 ${i + 1} · 이 시점 전후 ${UI.reviewSpanSec}초를 다시 확인해보세요</div>`;
    el.confGrid.appendChild(card);
  });
}
