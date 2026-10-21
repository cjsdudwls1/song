/** A-B 구간 상태. 순수 로직이라 단위 테스트 가능 */
export interface LoopState {
  a: number | null;
  b: number | null;
  enabled: boolean;
}

export const MIN_LOOP = 0.2;

/** 현재 시각 t에서 A로 되돌아가야 하는지 */
export function shouldJump(s: LoopState, t: number): boolean {
  return s.enabled && s.a !== null && s.b !== null && s.b - s.a >= MIN_LOOP && t >= s.b;
}

export function setA(s: LoopState, t: number): LoopState {
  const a = Math.max(0, round1(t));
  // A가 B를 넘어가면 B 해제
  const b = s.b !== null && s.b - a < MIN_LOOP ? null : s.b;
  return { a, b, enabled: b !== null && s.enabled };
}

export function setB(s: LoopState, t: number): LoopState {
  const b = round1(t);
  const a = s.a ?? 0;
  if (b - a < MIN_LOOP) return s;
  // B를 찍으면 바로 반복 시작 (리플레이어와 같은 동작)
  return { a, b, enabled: true };
}

/** ±미세조정. 상대 지점과 최소 간격 유지 */
export function nudge(s: LoopState, which: 'a' | 'b', delta: number, duration: number): LoopState {
  if (which === 'a') {
    if (s.a === null) return s;
    let a = round1(s.a + delta);
    a = Math.max(0, a);
    if (s.b !== null) a = Math.min(a, round1(s.b - MIN_LOOP));
    return { ...s, a };
  }
  if (s.b === null) return s;
  let b = round1(s.b + delta);
  if (duration > 0) b = Math.min(b, duration);
  b = Math.max(b, round1((s.a ?? 0) + MIN_LOOP));
  return { ...s, b };
}

export const round1 = (t: number) => Math.round(t * 10) / 10;

export function formatTime(t: number | null, withTenth = true): string {
  if (t === null || !Number.isFinite(t)) return '--:--';
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = withTenth ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  // 59.96 → "60.0" 방지
  if (withTenth && ss === '60.0') return `${neg ? '-' : ''}${m + 1}:00.0`;
  return `${neg ? '-' : ''}${m}:${ss}`;
}
