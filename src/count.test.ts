import { describe, expect, it } from 'vitest';
import { BpmTapper, eightCount, songBpm } from './count';

describe('count', () => {
  it('BPM 탭', () => {
    const t = new BpmTapper();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBeNull();
    expect(t.tap(1000)).toBe(120);
    expect(t.tap(1500)).toBe(120);
    // 2초 넘게 쉬면 리셋
    expect(t.tap(5000)).toBeNull();
  });

  it('배속 보정', () => {
    // 0.8배속에서 96 BPM으로 탭 → 원곡 120
    expect(songBpm(96, 0.8)).toBe(120);
  });

  it('8카운트', () => {
    // 120 BPM = 0.5초/박, 1이 10초
    expect(eightCount(10, 120, 10)).toBe(1);
    expect(eightCount(10.49, 120, 10)).toBe(1);
    expect(eightCount(10.5, 120, 10)).toBe(2);
    expect(eightCount(13.5, 120, 10)).toBe(8);
    expect(eightCount(14, 120, 10)).toBe(1);
    expect(eightCount(9.5, 120, 10)).toBe(8);
  });
});
