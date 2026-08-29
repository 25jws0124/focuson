#!/usr/bin/env node
/* =====================================================================
 * FocusOn — gen-cert.js
 *
 * 로컬 HTTPS 자체 서명 인증서 생성 스크립트.
 * 인증서는 "이 컴퓨터의 IP 주소" 기준으로 만들어지므로, 팀원 각자 자기
 * 컴퓨터에서 한 번씩 직접 실행해야 한다 (git에는 인증서 자체를 올리지 않음).
 *
 *   cd server
 *   npm run gen-cert
 *
 * 실행 후 server/certs/key.pem, cert.pem 이 생성되고, npm start로 서버를
 * 켜면 HTTP(3000)와 함께 HTTPS(3443)도 같이 뜬다. 같은 Wi-Fi의 다른 기기는
 * HTTPS 주소로 접속해야 카메라 권한이 허용된다 (브라우저 보안 정책).
 * ===================================================================== */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const certsDir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(certsDir, { recursive: true });

function findLanIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const lanIps = findLanIps();
const sanEntries = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps.map((ip) => `IP:${ip}`)];
const subjectAltName = `subjectAltName=${sanEntries.join(',')}`;

const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');

console.log('로컬 HTTPS 인증서를 생성합니다...');
console.log('포함되는 주소: ' + sanEntries.join(', '));

try {
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '365',
      '-subj', '/CN=focuson-local',
      '-addext', subjectAltName,
    ],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }
  );
} catch (e) {
  console.error('');
  console.error('인증서 생성에 실패했습니다. openssl이 설치되어 있는지 확인하세요.');
  console.error('(Windows는 Git for Windows에 기본 포함, macOS/Linux는 대부분 기본 설치되어 있습니다.)');
  process.exit(1);
}

console.log('');
console.log('완료! server/certs/key.pem, server/certs/cert.pem 생성됨.');
console.log('');
console.log('서버를 켠 뒤(npm start), 같은 Wi-Fi의 다른 기기에서 아래 주소로 접속하세요:');
if (lanIps.length) {
  lanIps.forEach((ip) => console.log('  https://' + ip + ':3443'));
} else {
  console.log('  (지금 Wi-Fi에 연결되어 있지 않아 LAN IP를 못 찾았습니다. Wi-Fi 연결 후 다시 실행하세요.)');
}
console.log('처음 접속 시 "안전하지 않음" 경고가 뜨면 "고급 > 계속 진행"을 눌러 통과하면 됩니다.');
