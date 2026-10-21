/** BPM 탭 / 8카운트 / 카운트인 비프 */

export class BpmTapper {
  private taps: number[] = [];

  /** 탭 시각(ms)을 넣으면 현재까지의 BPM(실시간 기준) 반환. 2초 이상 쉬면 새로 시작 */
  tap(now: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 9) this.taps.shift();
    if (this.taps.length < 3) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return (60000 * (this.taps.length - 1)) / span;
  }

  get count() {
    return this.taps.length;
  }
}

/** 재생 배속에서 탭한 BPM → 원곡 BPM */
export const songBpm = (tappedBpm: number, rate: number) => Math.round(tappedBpm / rate);

/** 곡 시각 t에서의 카운트(1~8). beatOne = "1"이 떨어지는 곡 시각 */
export function eightCount(t: number, bpm: number, beatOne: number): number {
  const beat = Math.floor(((t - beatOne) * bpm) / 60 + 1e-6);
  return (((beat % 8) + 8) % 8) + 1;
}

let ctx: AudioContext | null = null;

/** 사용자 제스처 안에서 호출해야 iOS에서 소리가 남 */
export function unlockAudio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** beats개의 비프를 interval초 간격으로 예약. onBeat(i)는 화면 표시용 */
export function countIn(beats: number, interval: number, onBeat: (i: number) => void, onDone: () => void): () => void {
  const c = unlockAudio();
  const timers: number[] = [];
  const t0 = c ? c.currentTime + 0.05 : 0;
  for (let i = 0; i < beats; i++) {
    if (c) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.frequency.value = i === beats - 1 ? 1320 : 880;
      const at = t0 + i * interval;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.6, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      osc.connect(g).connect(c.destination);
      osc.start(at);
      osc.stop(at + 0.1);
    }
    timers.push(window.setTimeout(() => onBeat(i), 50 + i * interval * 1000));
  }
  timers.push(window.setTimeout(onDone, 50 + beats * interval * 1000));
  return () => timers.forEach(clearTimeout);
}
