/* =====================================================================
 * FocusOn — ui/battle.js
 * 배틀룸. 백엔드가 있을 때만 화면에 나타난다.
 * ===================================================================== */

import { el } from './dom.js';
import { STATE_KO } from './theme.js';

/* --------------------------------------------------------- 배틀룸 */
/* 배틀룸과 학부모 리포트 발송은 Node 백엔드(server/)가 있어야 동작한다.
 * 정적 배포(Vercel 등)에는 백엔드가 없으므로:
 *   1) socket.io 스크립트 자체가 안 떠도 앱이 죽지 않게 가드한다.
 *      (이전엔 io가 undefined면 모듈 최상단에서 예외 → 카메라·엔진까지 전원 중단됐다.)
 *   2) 서버단 기능 UI는 기본적으로 숨기고, 실제로 연결될 때만 노출한다.
 *      눌러도 아무 일도 안 일어나는 버튼을 보여주지 않기 위함. */
const NOOP_SOCKET = { on() {}, emit() {} };
// 재시도를 3회로 제한한다. 기본값은 무한 재시도라, 백엔드가 없는 정적 배포에서
// /socket.io/ 404 요청을 세션 내내 5초마다 계속 보낸다(요청 수백 건 낭비 + 콘솔 오염).
const socket = (typeof io === 'function')
  ? io({ reconnectionAttempts: 3, timeout: 4000 })
  : NOOP_SOCKET;
let battleActive = false;

// 기본값: 백엔드 없음으로 가정 → 숨김 (연결되면 아래에서 다시 켜짐)
el.battle.hidden = true;
el.parentReportBox.hidden = true;

socket.on('connect', () => {
  // 한 번이라도 붙었으면 진짜 백엔드가 있는 것 → 이후 끊김은 무한 재시도로 복구한다.
  socket.io.reconnectionAttempts(Infinity);
  el.battle.hidden = false;
  el.parentReportBox.hidden = false;
});

socket.on('connect_error', (err) => {
  // 연결 실패는 정상 시나리오(정적 배포)라 화면에는 안 띄우되, 원인은 콘솔에 남긴다.
  console.info('[FocusOn] 백엔드 미연결 — 배틀룸/학부모 리포트 비활성화:', err?.message || err);
});

if (socket === NOOP_SOCKET) {
  console.info('[FocusOn] socket.io 스크립트를 불러오지 못했습니다 — 측정 기능은 그대로 동작합니다.');
}

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

/* 측정 중 내 점수를 상대에게 보내고 내 쪽 UI를 갱신한다.
 * 배틀룸이 비활성이면 아무 일도 하지 않으므로, 호출부는 조건을 몰라도 된다. */
export function reportScore(score, state) {
  if (!battleActive) return;
  socket.emit('battle:score', { score, state });
  el.battleMyScore.textContent = score;
  el.battleMyChip.dataset.state = state;
  el.battleMyChip.textContent = STATE_KO[state] || state;
}
