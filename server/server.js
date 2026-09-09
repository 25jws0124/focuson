/* =====================================================================
 * FocusOn — server.js (백엔드)
 *
 * - 프론트엔드(index.html/css/js)를 그대로 정적 서빙 (배포 시 서버 하나로 통합)
 * - POST /api/parent-report/send : 학부모 리포트 발송 "로직" (실제 이메일 발송 X, 콘솔 로그만)
 * - Socket.io 배틀룸 : 방 생성/참가/점수 relay/퇴장 처리 (메모리 Map, DB 없음)
 * ===================================================================== */

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // 로컬 개발 편의용. 실제 배포 시 origin 제한 권장.
});

const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------- HTTPS
 * 카메라 권한(getUserMedia)은 브라우저 보안 정책상 HTTPS 또는 localhost에서만 허용된다.
 * 발표자 본인 화면은 http://localhost 로도 카메라가 되지만, 같은 Wi-Fi의 다른 기기가
 * IP 주소(예: http://172.16.1.139:3000)로 접속하면 일반 HTTP라 카메라가 막힌다.
 * server/certs 에 자체 서명 인증서가 있으면 별도 포트로 HTTPS도 같이 띄운다.
 */
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
let httpsServer = null;
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  // 인증서가 깨져 있거나 절반만 생성됐으면 createServer 가 예외를 던진다.
  // 감싸지 않으면 그 예외로 프로세스가 죽어서 HTTP 서버까지 같이 안 뜬다.
  // HTTPS는 '다른 기기에서 카메라를 쓰기 위한 부가 기능'이므로, 실패해도 본체는 살아야 한다.
  try {
    httpsServer = https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      app
    );
    io.attach(httpsServer);
  } catch (e) {
    httpsServer = null;
    console.warn(
      '[HTTPS 건너뜀] server/certs 의 인증서를 읽지 못했습니다 (' + (e.code || e.message) + ')\n' +
      '  · 이 컴퓨터에서 http://localhost:' + PORT + ' 로 쓰는 데는 아무 문제 없습니다.\n' +
      '  · 다른 기기에서 카메라를 쓰려면: cd server && npm run gen-cert'
    );
  }
}

/* ------------------------------------------------------- 정적 파일
 * 프로젝트 루트를 통째로 서빙하면 안 된다. 예전 코드
 *   app.use(express.static(path.join(__dirname, '..')))
 * 는 /server/certs/key.pem (인증서 개인키), /server/node_modules/**,
 * /CLAUDE.md 까지 200으로 내줬다. 실제 응답을 확인한 사실이다.
 *
 * 그래서 프론트엔드에 필요한 것만 명시적으로 허용한다(허용 목록 방식).
 * 새 정적 폴더가 생기면 여기에 한 줄을 더해야 한다 — 일부러 불편하게 둔다.
 * 목록에 없는 경로는 전부 404. Vercel 배포본이 서빙하는 범위와 동일하다. */
const ROOT = path.join(__dirname, '..');
const STATIC_OPTS = { dotfiles: 'deny', index: false };

app.use('/css', express.static(path.join(ROOT, 'css'), STATIC_OPTS));
app.use('/js', express.static(path.join(ROOT, 'js'), STATIC_OPTS));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use(express.json());

/* ------------------------------------------------- 학부모 리포트 발송 */
app.post('/api/parent-report/send', (req, res) => {
  const { parentEmail, summary } = req.body || {};

  // 사용자 입력(이메일 주소, 리포트 내용)은 로그에 남기지 않는다.
  // 호스팅 서비스의 로그는 우리가 통제하지 못하는 곳에 보관된다.
  // 발송 여부를 추적하는 데 필요한 것은 "요청이 왔다"는 사실뿐이다.
  // 실제 이메일 연동 시에도 이 원칙은 같다 —
  // 외부 서비스의 오류 봉투(status/message)만 남기고 수신자·본문은 남기지 않는다.
  console.log('[모의 발송] 학부모 리포트 요청 1건 처리 (수신자·내용은 기록하지 않음)');

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

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, () => {
    console.log('HTTPS(다른 기기용, 카메라 허용됨)가 https://<이 컴퓨터의 IP>:' + HTTPS_PORT + ' 에서 실행 중입니다');
  });
}
