/* =====================================================================
 * FocusOn — server.js (백엔드)
 *
 * - 프론트엔드(index.html/css/js)를 그대로 정적 서빙 (배포 시 서버 하나로 통합)
 * - POST /api/parent-report/send : 학부모 리포트 발송 "로직" (실제 이메일 발송 X, 콘솔 로그만)
 * - Socket.io 배틀룸 : 방 생성/참가/점수 relay/퇴장 처리 (메모리 Map, DB 없음)
 * ===================================================================== */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // 로컬 개발 편의용. 실제 배포 시 origin 제한 권장.
});

const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------- 정적 파일 */
// 프로젝트 루트(index.html, css/, js/)를 그대로 서빙 → 서버 하나로 전체 앱 구동
app.use(express.static(path.join(__dirname, '..')));
app.use(express.json());

/* ------------------------------------------------- 학부모 리포트 발송 */
app.post('/api/parent-report/send', (req, res) => {
  const { parentEmail, summary } = req.body || {};

  console.log('[모의 발송] ' + parentEmail + '에게 보낼 리포트: ' + JSON.stringify(summary));

  res.json({
    ok: true,
    sent: false,
    note: '실제 이메일 발송은 아직 연결되지 않았습니다. 발송 로직은 준비됐고 이메일 서비스(API 키)만 연결하면 됩니다.',
  });
});

/* ---------------------------------------------------------- 배틀룸 */
// code -> { players: [socketId, socketId?] }
const battleRooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (battleRooms.has(code));
  return code;
}

function findRoomBySocket(socketId) {
  for (const [code, room] of battleRooms) {
    if (room.players.includes(socketId)) return code;
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('battle:create', () => {
    const code = makeRoomCode();
    battleRooms.set(code, { players: [socket.id] });
    socket.join(code);
    socket.emit('battle:created', { code });
  });

  socket.on('battle:join', ({ code } = {}) => {
    const room = battleRooms.get(code);
    if (!room) {
      socket.emit('battle:join-error', { reason: '존재하지 않는 방 코드입니다.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('battle:join-error', { reason: '이미 인원이 가득 찬 방입니다.' });
      return;
    }
    room.players.push(socket.id);
    socket.join(code);
    socket.emit('battle:joined', { code });
    socket.to(code).emit('battle:opponent-joined', { code });
  });

  socket.on('battle:score', ({ score, state } = {}) => {
    const code = findRoomBySocket(socket.id);
    if (!code) return;
    socket.to(code).emit('battle:opponent-score', { score, state });
  });

  socket.on('disconnect', () => {
    const code = findRoomBySocket(socket.id);
    if (!code) return;
    const room = battleRooms.get(code);
    if (!room) return;
    socket.to(code).emit('battle:opponent-left');
    room.players = room.players.filter((id) => id !== socket.id);
    if (room.players.length === 0) battleRooms.delete(code);
  });
});

server.listen(PORT, () => {
  console.log('FocusOn 서버가 http://localhost:' + PORT + ' 에서 실행 중입니다');
});
