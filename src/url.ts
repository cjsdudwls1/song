export type ParsedLink =
  | { kind: 'youtube'; videoId: string; start?: number }
  | { kind: 'spotify' }
  | { kind: 'unknown' };

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** "1m30s", "90", "90s" → 초 */
function parseStart(v: string | null): number | undefined {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** 붙여넣은 텍스트(앞뒤 문구 섞여도 됨)에서 링크를 찾아 파싱 */
export function parseLink(input: string): ParsedLink {
  const text = input.trim();
  if (!text) return { kind: 'unknown' };
  if (/spotify\.com|^spotify:/i.test(text)) return { kind: 'spotify' };
  if (ID_RE.test(text)) return { kind: 'youtube', videoId: text };

  // 공유 문구 안에 섞인 URL 추출
  const found = text.match(/(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube(?:-nocookie)?\.com|youtu\.be)\/\S+/i);
  if (!found) return { kind: 'unknown' };
  let raw = found[0];
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'unknown' };
  }
  const host = url.hostname.toLowerCase();
  const start = parseStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
  let id: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (YT_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  if (id && ID_RE.test(id)) return { kind: 'youtube', videoId: id, start };
  return { kind: 'unknown' };
}
