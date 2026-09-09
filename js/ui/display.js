/* =====================================================================
 * FocusOn — ui/display.js
 * 화면에 보이는 수치와 문구. HTML에는 숫자를 적지 않고 여기서 주입한다.
 * ===================================================================== */

import { el } from './dom.js';

/* ---------------------------------------------- 화면 수치의 유일한 출처
 * 여기 있는 값만 고치면 화면 문구와 계산이 함께 따라간다.
 * 예전엔 같은 숫자가 index.html 텍스트와 이 파일에 따로 박혀 있어서,
 * 한쪽만 고치면 화면이 거짓말을 하는 상태가 됐다. */
export const UI = {
  calibSec: 5,           // 보정 시간(초)
  recentWindowSec: 60,   // 미니 타임라인이 보여주는 구간
  reviewSpanSec: 30,     // '막힌 지점 복습' 안내에 쓰는 앞뒤 구간
  roomCodeLen: 4,        // 배틀룸 방 코드 자릿수 — server/server.js 의 makeRoomCode() 와 반드시 일치
};

// 링 둘레는 SVG의 r 속성에서 읽는다 (마크업이 유일한 출처, 숫자 중복 제거)
export const RING_LEN = 2 * Math.PI * Number(el.ringFill.getAttribute('r'));

/* 화면 문구 주입 — HTML에는 숫자를 적지 않는다 */
export function applyUiText() {
  el.miniTitle.textContent = `최근 ${UI.recentWindowSec}초`;
  el.confReviewHint.textContent =
    `이번 세션에서 눈썹 찌푸림 패턴이 감지된 지점입니다. 앞뒤 ${UI.reviewSpanSec}초 내용을 다시 확인해보세요.`;
  el.calibNum.textContent = String(UI.calibSec);
  el.battleCodeInput.maxLength = UI.roomCodeLen;
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
