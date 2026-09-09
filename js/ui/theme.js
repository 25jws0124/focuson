/* =====================================================================
 * FocusOn — ui/theme.js
 * 색과 상태 이름. 색의 출처는 css/style.css 의 :root 하나뿐이다.
 * ===================================================================== */

export const STATE_KO = { focused: '집중', distracted: '딴짓', drowsy: '졸음', away: '자리 이탈', idle: '대기' };

/* ------------------------------------------------ 색: CSS 변수가 유일한 출처
 * 캔버스는 CSS를 쓸 수 없어 색 값을 직접 넣어야 한다. 그렇다고 여기에 hex를 적으면
 * style.css 의 :root 를 바꿔도 캔버스만 옛 색으로 남아 화면 절반만 바뀐다.
 * 그래서 :root 값을 한 번 읽어와 이 객체로만 쓴다. 색을 바꾸는 곳은 CSS 한 곳뿐. */
export const cssVar = (name, fallback = '#000000') =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** '#rrggbb' → 'rgba(r,g,b,a)'  — 캔버스에서 투명도를 줄 때 */
export function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const C = {
  teal:    cssVar('--accent-teal'),
  ink:     cssVar('--ink'),
  muted:   cssVar('--muted'),
  success: cssVar('--success'),
  warning: cssVar('--warning'),
  error:   cssVar('--error'),
};

export const STATE_COLOR = { focused: C.success, distracted: C.warning, drowsy: C.error, away: C.muted };
