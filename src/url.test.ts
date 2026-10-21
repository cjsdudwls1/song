import { describe, expect, it } from 'vitest';
import { parseLink } from './url';

const ID = 'dQw4w9WgXcQ';

describe('parseLink', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&list=RD123&index=2`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&si=abc`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=xyz`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `이 노래 들어봐 https://youtu.be/${ID} 대박`,
    ID,
  ])('%s', (input) => {
    expect(parseLink(input)).toMatchObject({ kind: 'youtube', videoId: ID });
  });

  it('시작 시간 파싱', () => {
    expect(parseLink(`https://youtu.be/${ID}?t=90`)).toMatchObject({ start: 90 });
    expect(parseLink(`https://www.youtube.com/watch?v=${ID}&t=1m5s`)).toMatchObject({ start: 65 });
  });

  it('스포티파이', () => {
    expect(parseLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1').kind).toBe('spotify');
    expect(parseLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC').kind).toBe('spotify');
  });

  it('잘못된 링크', () => {
    expect(parseLink('https://example.com/watch?v=' + ID).kind).toBe('unknown');
    expect(parseLink('https://www.youtube.com/watch?v=short').kind).toBe('unknown');
    expect(parseLink('').kind).toBe('unknown');
    expect(parseLink('hello').kind).toBe('unknown');
  });
});
