/* =====================================================================
 * FocusOn — focus-engine.js
 * 온디바이스 실시간 집중도 측정 엔진 (우리 팀의 "API")
 *
 * 계약(API)은 README.md 3번 항목과 100% 동일합니다.
 * 영상 프레임은 이 파일 안에서만 처리되고 네트워크로 절대 나가지 않습니다.
 * (네트워크는 최초 1회 MediaPipe 모델/WASM 다운로드에만 사용됩니다.)
 * ===================================================================== */

import {
  FaceLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

/* ---------------------------------------------------------------- utils */
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const DEG = 180 / Math.PI;

/** 각도 차이를 -180~180 으로 정규화 */
function angDiff(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** MediaPipe 4x4 변환행렬(column-major, 길이 16) → 오일러각(도) */
function eulerFromMatrix(m) {
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r21 = m[6], r22 = m[10];
  const sy = Math.hypot(r00, r10);
  return {
    pitch: Math.atan2(r21, r22) * DEG,  // 고개 끄덕임(위/아래)
    yaw:   Math.atan2(-r20, sy) * DEG,  // 고개 돌림(좌/우)
    roll:  Math.atan2(r10, r00) * DEG,  // 고개 기울임
  };
}

/* ------------------------------------------------------------- defaults */
export const DEFAULT_CONFIG = {
  // 모델 소스 (오프라인 발표가 걱정되면 이 두 개를 로컬 파일로 바꾸세요)
  wasmUrl:  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  modelUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',

  targetFps: 20,        // 분석 목표 FPS (rAF를 이 주기로 스로틀)
  logHz: 2,             // 리포트용 로그 적재 주기 (문서: 약 2Hz)
  smoothingTauMs: 800,  // 점수 이동평균 시상수 (≈1초)

  // 감점 가중치 (합이 곧 최대 감점폭)
  weights: { head: 40, gaze: 35, eyes: 45 },

  // 기준선 대비 허용 오차(deadzone)와 100% 감점까지의 폭(range)
  head: { deadzoneDeg: 8,   rangeDeg: 28 },
  gaze: { deadzone: 0.12,   range: 0.42 },
  eyes: { deadzone: 0.12,   range: 0.50 },

  // 상태 판정
  thresholds: {
    focused: 66,        // 이 이상이면 집중 후보
    distracted: 54,     // 이 미만이면 딴짓 후보
    eyeClosedOff: 0.62, // eyeOff 가 이 이상이면 "눈 감김"
    perclosWindowMs: 10000,
    perclosRatio: 0.35, // 최근 10초 중 35% 이상 감겨 있으면 졸음
  },
  // 상태가 실제로 바뀌기까지 유지돼야 하는 시간 (깜빡임 오판 방지)
  dwellMs: { focused: 1000, distracted: 1200, drowsy: 1500, away: 1200 },

  // 혼란(막힌 지점) — 눈썹 찌푸림/치켜올림
  confusion: { level: 0.20, holdMs: 600, cooldownMs: 5000 },

  // 리포트
  minSegmentMs: 1200,   // 이보다 짧은 구간은 리포트에 안 넣음
};

const ZERO_BASELINE = {
  pitch: 0, yaw: 0, roll: 0,
  gazeX: 0, gazeY: 0,
  eyeClose: 0.05, browDown: 0.05, browUp: 0.05,
  neutral: true,
};

/* ================================================================ engine */
export class FocusEngine {
  constructor(config = {}) {
    this.cfg = deepMerge(DEFAULT_CONFIG, config);
    this.isMock = false;

    this._handlers = Object.create(null);
    this._landmarker = null;
    this._video = null;

    this.phase = 'idle';          // idle|loading|ready|calibrating|running|stopped
    this.baseline = null;

    this._raf = null;
    this._lastDetectTs = -1;
    this._lastFrameAt = 0;

    this._sessionStart = 0;
    this._smoothScore = 100;
    this._state = 'focused';
    this._candState = 'focused';
    this._candSince = 0;
    this._lastFaceAt = 0;
    this._perclos = [];           // {t, closed}
    this._browHighSince = 0;
    this._lastConfusionAt = -1e9;
    this._lastLogAt = 0;

    this._log = [];               // {t, score, state}
    this._events = [];            // {type:'confusion', t}
    this._segments = [];          // {type, startT, endT}
    this._segOpen = null;

    this._calib = null;
  }

  /* ------------------------------------------------------------ events */
  on(evt, cb) {
    (this._handlers[evt] ||= []).push(cb);
    return () => this.off(evt, cb);
  }
  off(evt, cb) {
    const a = this._handlers[evt];
    if (a) this._handlers[evt] = a.filter((f) => f !== cb);
  }
  _emit(evt, payload) {
    for (const f of this._handlers[evt] || []) {
      try { f(payload); } catch (e) { console.error('[FocusEngine] handler error:', e); }
    }
  }
  _setPhase(p) {
    if (this.phase === p) return;
    this.phase = p;
    this._emit('status', { phase: p });
  }

  /* -------------------------------------------------------------- init */
  /** MediaPipe 모델 로드 (세션당 1회) */
  async init() {
    if (this._landmarker) return;
    this._setPhase('loading');
    const fileset = await FilesetResolver.forVisionTasks(this.cfg.wasmUrl);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: this.cfg.modelUrl, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this._landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('[FocusEngine] GPU 델리게이트 실패 → CPU로 전환', e);
      this._landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    this._setPhase('ready');
  }

  /** 분석할 <video> 연결 */
  attach(videoEl) {
    this._video = videoEl;
    return this;
  }

  /* ------------------------------------------------------- calibration */
  /**
   * seconds 초 동안 "정면을 편하게 보는" 기준선을 측정한다.
   * 사람마다 정면 자세가 다르므로 이후 모든 판정은 이 기준선 대비 편차로 이뤄진다.
   * @returns {Promise<object>} baseline
   */
  calibrate(seconds = 5) {
    if (!this._landmarker) return Promise.reject(new Error('init()을 먼저 호출하세요.'));
    if (!this._video) return Promise.reject(new Error('attach(videoEl)를 먼저 호출하세요.'));

    return new Promise((resolve, reject) => {
      this._calib = {
        endAt: performance.now() + seconds * 1000,
        total: seconds * 1000,
        samples: { pitch: [], yaw: [], roll: [], gazeX: [], gazeY: [], eyeClose: [], browDown: [], browUp: [] },
        resolve, reject,
      };
      this._setPhase('calibrating');
      this._startLoop();
    });
  }

  _finishCalibration() {
    const s = this._calib.samples;
    const ok = s.pitch.length >= 5;
    if (!ok) {
      // 얼굴을 거의 못 잡았으면 중립 기준선으로라도 진행 (데모 중단 방지)
      this.baseline = { ...ZERO_BASELINE };
      console.warn('[FocusEngine] 캘리브레이션 샘플 부족 → 중립 기준선 사용');
    } else {
      // 평균 대신 중앙값 — 순간적으로 튄 프레임에 강함
      this.baseline = {
        pitch: median(s.pitch), yaw: median(s.yaw), roll: median(s.roll),
        gazeX: median(s.gazeX), gazeY: median(s.gazeY),
        eyeClose: median(s.eyeClose),
        browDown: median(s.browDown), browUp: median(s.browUp),
        neutral: false,
      };
    }
    const done = this._calib;
    this._calib = null;
    this._stopLoop();
    this._setPhase('ready');
    this._emit('calibration', { progress: 1, done: true, baseline: this.baseline });
    done.resolve(this.baseline);
  }

  /* ------------------------------------------------------------- start */
  start() {
    if (!this._landmarker) throw new Error('init()을 먼저 호출하세요.');
    if (!this._video) throw new Error('attach(videoEl)를 먼저 호출하세요.');
    if (!this.baseline) {
      console.warn('[FocusEngine] 보정 없이 시작 → 중립 기준선 사용 (정확도 낮음)');
      this.baseline = { ...ZERO_BASELINE };
    }
    const now = performance.now();
    this._sessionStart = now;
    this._smoothScore = 100;
    this._state = 'focused';
    this._candState = 'focused';
    this._candSince = now;
    this._lastFaceAt = now;
    this._perclos = [];
    this._browHighSince = 0;
    this._lastConfusionAt = -1e9;
    this._lastLogAt = 0;
    this._log = [];
    this._events = [];
    this._segments = [];
    this._segOpen = null;

    this._setPhase('running');
    this._startLoop();
  }

  stop() {
    this._stopLoop();
    if (this.phase === 'running') {
      this._closeSegment(this._now());
      this._setPhase('stopped');
    }
  }

  /* -------------------------------------------------------------- loop */
  _now() { return performance.now() - this._sessionStart; }

  _startLoop() {
    if (this._raf) return;
    const minDt = 1000 / this.cfg.targetFps;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - this._lastFrameAt < minDt) return;
      this._lastFrameAt = now;
      try { this._tick(now); } catch (e) { console.error('[FocusEngine] tick error:', e); }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /* -------------------------------------------- 1단계: 특징 추출 */
  _extract(nowMs) {
    const v = this._video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return null;
    // detectForVideo 의 timestamp 는 반드시 단조 증가해야 함
    let ts = Math.round(nowMs);
    if (ts <= this._lastDetectTs) ts = this._lastDetectTs + 1;
    this._lastDetectTs = ts;

    const res = this._landmarker.detectForVideo(v, ts);
    const has = res.faceLandmarks && res.faceLandmarks.length > 0;
    if (!has) return { present: false };

    const bs = Object.create(null);
    const cats = res.faceBlendshapes?.[0]?.categories || [];
    for (const c of cats) bs[c.categoryName] = c.score;
    const g = (k) => bs[k] || 0;

    const m = res.facialTransformationMatrixes?.[0]?.data;
    const rot = m ? eulerFromMatrix(m) : { pitch: 0, yaw: 0, roll: 0 };

    return {
      present: true,
      ...rot,
      // 졸음: 눈 감김 정도
      eyeClose: (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2,
      // 시선: +X = 사용자 기준 왼쪽, +Y = 위
      gazeX: ((g('eyeLookOutLeft') + g('eyeLookInRight')) - (g('eyeLookInLeft') + g('eyeLookOutRight'))) / 2,
      gazeY: ((g('eyeLookUpLeft') + g('eyeLookUpRight')) - (g('eyeLookDownLeft') + g('eyeLookDownRight'))) / 2,
      // 혼란: 눈썹
      browDown: (g('browDownLeft') + g('browDownRight')) / 2,
      browUp: g('browInnerUp'),
      landmarks: res.faceLandmarks[0],
    };
  }

  _tick(nowMs) {
    const f = this._extract(nowMs);
    if (!f) return;

    /* --- 캘리브레이션 단계 --- */
    if (this._calib) {
      if (f.present) {
        const s = this._calib.samples;
        s.pitch.push(f.pitch); s.yaw.push(f.yaw); s.roll.push(f.roll);
        s.gazeX.push(f.gazeX); s.gazeY.push(f.gazeY);
        s.eyeClose.push(f.eyeClose);
        s.browDown.push(f.browDown); s.browUp.push(f.browUp);
      }
      const remain = this._calib.endAt - nowMs;
      this._emit('calibration', {
        progress: clamp(1 - remain / this._calib.total),
        done: false,
        facePresent: f.present,
        samples: this._calib.samples.pitch.length,
      });
      this._emit('frame', { landmarks: f.landmarks || null, present: f.present });
      if (remain <= 0) this._finishCalibration();
      return;
    }

    if (this.phase !== 'running') return;

    const t = this._now();
    const b = this.baseline;

    /* --- 2단계: 기준선 대비 편차 --- */
    let headOff = 0, gazeOff = 0, eyeOff = 0;
    if (f.present) {
      this._lastFaceAt = nowMs;
      const headDev = Math.hypot(angDiff(f.pitch, b.pitch), angDiff(f.yaw, b.yaw));
      headOff = clamp((headDev - this.cfg.head.deadzoneDeg) / this.cfg.head.rangeDeg);

      const gazeDev = Math.hypot(f.gazeX - b.gazeX, f.gazeY - b.gazeY);
      gazeOff = clamp((gazeDev - this.cfg.gaze.deadzone) / this.cfg.gaze.range);

      eyeOff = clamp((f.eyeClose - b.eyeClose - this.cfg.eyes.deadzone) / this.cfg.eyes.range);
    }

    /* --- 3단계: 점수 융합 --- */
    const w = this.cfg.weights;
    const raw = f.present
      ? clamp(100 - (w.head * headOff + w.gaze * gazeOff + w.eyes * eyeOff), 0, 100)
      : 0;

    /* --- 4단계: 시계열 안정화(EMA) --- */
    const dt = Math.max(1, nowMs - (this._lastEmaAt || nowMs));
    this._lastEmaAt = nowMs;
    const alpha = 1 - Math.exp(-dt / this.cfg.smoothingTauMs);
    this._smoothScore += (raw - this._smoothScore) * alpha;
    const score = Math.round(this._smoothScore);

    /* --- 4단계: 상태머신 --- */
    if (f.present) {
      this._perclos.push({ t: nowMs, closed: eyeOff >= this.cfg.thresholds.eyeClosedOff });
      const pw = this.cfg.thresholds.perclosWindowMs;
      while (this._perclos.length && nowMs - this._perclos[0].t > pw) this._perclos.shift();
    } else {
      // 자리를 비운 동안의 창은 통째로 버린다.
      // (버리지 않으면 돌아온 직후 이전 졸음 샘플 때문에 '졸음'으로 오판됨)
      this._perclos.length = 0;
    }
    const minSamples = Math.round(this.cfg.targetFps * 3);   // 최소 3초치는 쌓여야 PERCLOS 판정
    const perclos = this._perclos.length >= minSamples
      ? this._perclos.filter((p) => p.closed).length / this._perclos.length
      : 0;

    let cand;
    if (!f.present) cand = 'away';
    else if (eyeOff >= this.cfg.thresholds.eyeClosedOff || perclos >= this.cfg.thresholds.perclosRatio) cand = 'drowsy';
    else if (score < this.cfg.thresholds.distracted) cand = 'distracted';
    else if (score >= this.cfg.thresholds.focused) cand = 'focused';
    else cand = this._state; // 히스테리시스 구간 — 현재 상태 유지

    if (cand !== this._candState) { this._candState = cand; this._candSince = nowMs; }
    const dwell = this.cfg.dwellMs[cand] ?? 1000;
    if (cand !== this._state && nowMs - this._candSince >= dwell) {
      this._closeSegment(t);
      this._state = cand;
      this._openSegment(cand, t);
    }

    /* --- 혼란(막힌 지점) 감지 --- */
    if (f.present) {
      const furrow = Math.max(f.browDown - b.browDown, f.browUp - b.browUp);
      if (furrow >= this.cfg.confusion.level) {
        if (!this._browHighSince) this._browHighSince = nowMs;
        if (nowMs - this._browHighSince >= this.cfg.confusion.holdMs &&
            nowMs - this._lastConfusionAt >= this.cfg.confusion.cooldownMs) {
          this._lastConfusionAt = nowMs;
          this._browHighSince = 0;
          this._events.push({ type: 'confusion', t: Math.round(t) });
          this._emit('confusion', { t: Math.round(t) });
        }
      } else {
        this._browHighSince = 0;
      }
    }

    /* --- 결과 방출 --- */
    // signals: 1 = 기준선에 가깝다(좋음), 0 = 완전히 벗어남 (UI 막대바 = 채워질수록 좋음)
    const signals = {
      head: f.present ? 1 - headOff : 0,
      gaze: f.present ? 1 - gazeOff : 0,
      eyes: f.present ? 1 - eyeOff : 0,
    };
    this._emit('score', { score, state: this._state, signals, t: Math.round(t) });
    this._emit('frame', { landmarks: f.landmarks || null, present: f.present });

    /* --- 로그 적재 (약 2Hz) --- */
    const logDt = 1000 / this.cfg.logHz;
    if (t - this._lastLogAt >= logDt) {
      this._lastLogAt = t;
      this._log.push({ t: Math.round(t), score, state: this._state });
    }
  }

  /* ---------------------------------------------------------- segments */
  _openSegment(type, t) {
    if (type === 'focused') { this._segOpen = null; return; }
    this._segOpen = { type, startT: Math.round(t) };
  }
  _closeSegment(t) {
    if (!this._segOpen) return;
    const seg = { ...this._segOpen, endT: Math.round(t) };
    if (seg.endT - seg.startT >= this.cfg.minSegmentMs) this._segments.push(seg);
    this._segOpen = null;
  }

  /* ------------------------------------------------------------ report */
  getReport() {
    const durationMs = this._log.length ? this._log[this._log.length - 1].t : 0;
    const focusedCount = this._log.filter((r) => r.state === 'focused').length;
    return {
      durationSec: Math.round(durationMs / 1000),
      focusRatio: this._log.length ? focusedCount / this._log.length : 0,
      avgScore: this._log.length
        ? Math.round(this._log.reduce((a, r) => a + r.score, 0) / this._log.length)
        : 0,
      timeline: this._log.map((r) => ({ t: r.t, score: r.score })),
      segments: [...this._segments],
      events: [...this._events],
    };
  }

  /** 리소스 해제 */
  dispose() {
    this.stop();
    try { this._landmarker?.close(); } catch (_) {}
    this._landmarker = null;
  }
}

export default FocusEngine;
