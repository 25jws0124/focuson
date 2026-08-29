/* =====================================================================
 * FocusOn — mock-engine.js
 * focus-engine.js 와 "완전히 동일한 계약"을 지키는 가짜 엔진.
 * 카메라도, MediaPipe도, 네트워크도 필요 없습니다.
 *
 * 용도: 프론트엔드 담당이 진짜 엔진 완성을 기다리지 않고 UI를 끝내기 위함.
 * 사용법: index.html 을 열 때 주소 뒤에 ?mock 만 붙이면 됩니다.
 *         http://localhost:8000/?mock
 * ===================================================================== */

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export class FocusEngine {
  constructor(config = {}) {
    this.cfg = { logHz: 2, tickMs: 60, ...config };
    this.isMock = true;
    this.phase = 'idle';
    this.baseline = null;
    this._handlers = Object.create(null);
    this._timer = null;
    this._log = [];
    this._events = [];
    this._segments = [];
    this._segOpen = null;
    this._state = 'focused';
    this._score = 92;
    this._t0 = 0;
    this._lastLogAt = 0;
    this._scenarioAt = 0;
    this._sig = { head: 0.95, gaze: 0.93, eyes: 0.97 };
  }

  on(evt, cb) { (this._handlers[evt] ||= []).push(cb); return () => this.off(evt, cb); }
  off(evt, cb) { const a = this._handlers[evt]; if (a) this._handlers[evt] = a.filter((f) => f !== cb); }
  _emit(evt, p) { for (const f of this._handlers[evt] || []) { try { f(p); } catch (e) { console.error(e); } } }
  _setPhase(p) { this.phase = p; this._emit('status', { phase: p }); }

  async init() {
    this._setPhase('loading');
    await new Promise((r) => setTimeout(r, 700));   // 모델 로딩 흉내
    this._setPhase('ready');
  }

  attach(videoEl) { this._video = videoEl; return this; }

  calibrate(seconds = 5) {
    this._setPhase('calibrating');
    const total = seconds * 1000;
    const start = performance.now();
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        const p = clamp((performance.now() - start) / total);
        this._emit('calibration', { progress: p, done: p >= 1, facePresent: true });
        if (p >= 1) {
          clearInterval(iv);
          this.baseline = { mock: true };
          this._setPhase('ready');
          resolve(this.baseline);
        }
      }, 100);
    });
  }

  start() {
    this._t0 = performance.now();
    this._log = []; this._events = []; this._segments = []; this._segOpen = null;
    this._state = 'focused'; this._score = 92; this._lastLogAt = 0; this._scenarioAt = 0;
    this._setPhase('running');
    this._timer = setInterval(() => this._tick(), this.cfg.tickMs);
  }

  stop() {
    clearInterval(this._timer); this._timer = null;
    if (this.phase === 'running') { this._closeSegment(this._now()); this._setPhase('stopped'); }
  }

  _now() { return performance.now() - this._t0; }

  /** 30초 주기로 집중 → 딴짓 → 집중 → 졸음 → 이탈 → 집중 시나리오를 돈다 */
  _scenarioState(t) {
    const c = (t / 1000) % 40;
    if (c < 12) return 'focused';
    if (c < 18) return 'distracted';
    if (c < 26) return 'focused';
    if (c < 31) return 'drowsy';
    if (c < 34) return 'away';
    return 'focused';
  }

  _tick() {
    const t = this._now();
    const target = this._scenarioState(t);
    const targetScore = { focused: 88, distracted: 42, drowsy: 28, away: 0 }[target];
    const noise = (Math.random() - 0.5) * 6;
    this._score += (targetScore + noise - this._score) * 0.09;
    const score = Math.round(clamp(this._score, 0, 100));

    // 상태는 점수보다 조금 늦게 따라오게 (실제 엔진의 dwell 흉내)
    if (Math.abs(score - targetScore) < 14) this._state = target;

    const tgt = {
      focused:    { head: 0.95, gaze: 0.92, eyes: 0.97 },
      distracted: { head: 0.45, gaze: 0.25, eyes: 0.90 },
      drowsy:     { head: 0.60, gaze: 0.55, eyes: 0.12 },
      away:       { head: 0.00, gaze: 0.00, eyes: 0.00 },
    }[target];
    for (const k of ['head', 'gaze', 'eyes']) {
      this._sig[k] += (tgt[k] + (Math.random() - 0.5) * 0.08 - this._sig[k]) * 0.12;
      this._sig[k] = clamp(this._sig[k]);
    }

    this._emit('score', { score, state: this._state, signals: { ...this._sig }, t: Math.round(t) });
    this._emit('frame', { landmarks: null, present: target !== 'away' });

    // 12초쯤마다 '막힌 지점'
    if (t - this._scenarioAt > 12000 && Math.random() < 0.35) {
      this._scenarioAt = t;
      this._events.push({ type: 'confusion', t: Math.round(t) });
      this._emit('confusion', { t: Math.round(t) });
    }

    // 구간 기록
    if (this._state !== (this._segOpen?.type ?? 'focused')) {
      this._closeSegment(t);
      if (this._state !== 'focused') this._segOpen = { type: this._state, startT: Math.round(t) };
    }

    const logDt = 1000 / this.cfg.logHz;
    if (t - this._lastLogAt >= logDt) {
      this._lastLogAt = t;
      this._log.push({ t: Math.round(t), score, state: this._state });
    }
  }

  _closeSegment(t) {
    if (!this._segOpen) return;
    const seg = { ...this._segOpen, endT: Math.round(t) };
    if (seg.endT - seg.startT >= 1000) this._segments.push(seg);
    this._segOpen = null;
  }

  getReport() {
    const durationMs = this._log.length ? this._log[this._log.length - 1].t : 0;
    const focused = this._log.filter((r) => r.state === 'focused').length;
    return {
      durationSec: Math.round(durationMs / 1000),
      focusRatio: this._log.length ? focused / this._log.length : 0,
      avgScore: this._log.length ? Math.round(this._log.reduce((a, r) => a + r.score, 0) / this._log.length) : 0,
      timeline: this._log.map((r) => ({ t: r.t, score: r.score })),
      segments: [...this._segments],
      events: [...this._events],
    };
  }

  dispose() { this.stop(); }
}

export const MockFocusEngine = FocusEngine;
export default FocusEngine;
