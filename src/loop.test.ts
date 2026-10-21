import { describe, expect, it } from 'vitest';
import { formatTime, nudge, setA, setB, shouldJump, type LoopState } from './loop';

const empty: LoopState = { a: null, b: null, enabled: false };

describe('A-B loop', () => {
  it('A → B 찍으면 반복 활성', () => {
    let s = setA(empty, 10.04);
    expect(s).toEqual({ a: 10, b: null, enabled: false });
    s = setB(s, 15.26);
    expect(s).toEqual({ a: 10, b: 15.3, enabled: true });
    expect(shouldJump(s, 15.29)).toBe(false);
    expect(shouldJump(s, 15.3)).toBe(true);
    expect(shouldJump({ ...s, enabled: false }, 20)).toBe(false);
  });

  it('A 없이 B만 찍으면 A=0', () => {
    expect(setB(empty, 5)).toEqual({ a: 0, b: 5, enabled: true });
  });

  it('B가 A보다 앞이면 무시', () => {
    const s = setA(empty, 10);
    expect(setB(s, 9)).toBe(s);
  });

  it('A를 B 뒤로 옮기면 B 해제', () => {
    const s = setB(setA(empty, 10), 15);
    expect(setA(s, 16)).toEqual({ a: 16, b: null, enabled: false });
  });

  it('미세 조정', () => {
    const s = setB(setA(empty, 10), 15);
    expect(nudge(s, 'a', 0.1, 100).a).toBe(10.1);
    expect(nudge(s, 'a', -0.1, 100).a).toBe(9.9);
    expect(nudge(s, 'b', 0.1, 100).b).toBe(15.1);
    expect(nudge(s, 'b', 1, 15.5).b).toBe(15.5);
    expect(nudge({ ...s, a: 0 }, 'a', -0.1, 100).a).toBe(0);
    expect(nudge({ ...s, b: 10.2 }, 'b', -0.1, 100).b).toBe(10.2);
  });

  it('formatTime', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.43)).toBe('1:05.4');
    expect(formatTime(59.97)).toBe('1:00.0');
    expect(formatTime(null)).toBe('--:--');
    expect(formatTime(125, false)).toBe('2:05');
  });
});
