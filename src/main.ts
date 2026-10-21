import './style.css';
import { parseLink } from './url';
import { LocalPlayer, YouTubePlayer, clampRate, type Player, type PlayerEvents } from './player';
import { formatTime, nudge, setA, setB, shouldJump, type LoopState } from './loop';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  url: $<HTMLInputElement>('url'),
  paste: $('paste'),
  file: $<HTMLInputElement>('file'),
  notice: $('notice'),
  stageWrap: $('stageWrap'),
  stage: $('stage'),
  title: $('title'),
  seekbar: $<HTMLInputElement>('seekbar'),
  progress: $('progress'),
  abRange: $('abRange'),
  cur: $('cur'),
  dur: $('dur'),
  play: $('play'),
  btnA: $('btnA'),
  btnB: $('btnB'),
  timeA: $('timeA'),
  timeB: $('timeB'),
  loop: $('loop'),
  clearAB: $('clearAB'),
  rateDown: $('rateDown'),
  rateUp: $('rateUp'),
  rateVal: $('rateVal'),
  rates: $('rates'),
  rateNote: $('rateNote'),
  toast: $('toast'),
};

let player: Player | null = null;
let loop: LoopState = { a: null, b: null, enabled: false };
let seeking = false; // 시크바 드래그 중

// ───────────────────────── 로딩 ─────────────────────────

function showNotice(html: string | null) {
  el.notice.hidden = !html;
  el.notice.innerHTML = html ?? '';
}

let toastTimer = 0;
export function toast(msg: string) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.toast.hidden = true), 2200);
}

function makeEvents(): PlayerEvents {
  return {
    onReady: () => {
      renderRates();
      renderAll();
    },
    onStateChange: () => renderAll(),
    onRateChange: () => renderRates(),
    onError: (code) => handleError(code),
  };
}

function resetSession() {
  player?.destroy();
  player = null;
  loop = { a: null, b: null, enabled: false };
  showNotice(null);
  el.stageWrap.classList.remove('empty');
}

function loadYouTube(videoId: string, start?: number) {
  if (player?.kind === 'youtube' && (player as YouTubePlayer).videoId === videoId) return;
  resetSession();
  el.stageWrap.classList.remove('compact');
  player = new YouTubePlayer(el.stage, videoId, makeEvents(), start);
  el.title.textContent = '';
  renderAll();
}

function loadFile(file: Blob, name: string) {
  resetSession();
  const p = new LocalPlayer(el.stage, file, name, makeEvents());
  el.stageWrap.classList.toggle('compact', p.el.tagName === 'AUDIO');
  player = p;
  renderAll();
}

function handleInput(text: string): boolean {
  const link = parseLink(text);
  if (link.kind === 'youtube') {
    loadYouTube(link.videoId, link.start);
    return true;
  }
  if (link.kind === 'spotify') {
    showNotice('스포티파이는 재생 속도 조절이 불가능해서 지원하지 않아요.<br>같은 곡을 <b>유튜브</b>에서 찾아 링크를 붙여넣어 주세요.');
    return false;
  }
  if (text.trim()) toast('유튜브 링크를 인식하지 못했어요');
  return false;
}

function handleError(code: number) {
  const id = player?.kind === 'youtube' ? (player as YouTubePlayer).videoId : '';
  const ytLink = id
    ? `<a class="btn primary" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">유튜브에서 열기</a>`
    : '';
  let msg: string;
  switch (code) {
    case 101:
    case 150:
    case 153:
      msg = '이 곡은 유튜브에서 <b>외부 재생을 막아둔</b> 영상이에요. 다른 업로드(가사 영상, 커버 등)를 찾아보거나 유튜브에서 직접 열어주세요.';
      break;
    case 100:
      msg = '삭제되었거나 비공개인 영상이에요.';
      break;
    case 2:
      msg = '잘못된 영상 주소예요.';
      break;
    case 5:
      msg = '이 브라우저에서 재생할 수 없는 영상이에요.';
      break;
    case -2:
      msg = '유튜브 플레이어를 불러오지 못했어요. 인터넷 연결을 확인해주세요.';
      break;
    default:
      msg = `재생 오류 (${code})`;
  }
  showNotice(`${msg}<br>${code === -2 ? '' : ytLink}`);
}

el.url.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  if (text && handleInput(text)) {
    e.preventDefault();
    el.url.value = text.trim();
    el.url.blur();
  }
});
el.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleInput(el.url.value);
    el.url.blur();
  }
});
el.url.addEventListener('change', () => handleInput(el.url.value));

el.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    el.url.value = text.trim();
    handleInput(text);
  } catch {
    // 권한 거부/미지원 → 입력창에 포커스해서 직접 붙여넣게
    el.url.focus();
    toast('입력창을 길게 눌러 붙여넣기 해주세요');
  }
});

el.file.addEventListener('change', () => {
  const f = el.file.files?.[0];
  if (f) loadFile(f, f.name);
  el.file.value = '';
});

// ───────────────────────── 재생 컨트롤 ─────────────────────────

function togglePlay() {
  if (!player) return;
  if (player.isPlaying()) player.pause();
  else {
    // 반복 구간 밖에서 재생 누르면 A부터
    const t = player.getTime();
    if (loop.enabled && loop.a !== null && loop.b !== null && (t < loop.a - 0.05 || t >= loop.b)) player.seek(loop.a);
    player.play();
  }
}

function seekBy(d: number) {
  if (!player) return;
  player.seek(Math.max(0, player.getTime() + d));
  renderAll();
}

el.play.addEventListener('click', togglePlay);
document.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.act === 'back5') seekBy(-5);
    if (b.dataset.act === 'fwd5') seekBy(5);
  }),
);

el.seekbar.addEventListener('input', () => {
  seeking = true;
  el.cur.textContent = formatTime(Number(el.seekbar.value));
});
el.seekbar.addEventListener('change', () => {
  seeking = false;
  player?.seek(Number(el.seekbar.value));
});

// ───────────────────────── A-B ─────────────────────────

function updateLoop(next: LoopState) {
  const wasEnabled = loop.enabled;
  loop = next;
  // 반복이 새로 켜지면 바로 A로 (B 찍는 순간 반복 시작)
  if (player && loop.enabled && !wasEnabled && loop.a !== null) player.seek(loop.a);
  renderAB();
}

el.btnA.addEventListener('click', () => player && updateLoop(setA(loop, player.getTime())));
el.btnB.addEventListener('click', () => {
  if (!player) return;
  const next = setB(loop, player.getTime());
  if (next === loop) toast('B는 A보다 뒤여야 해요');
  updateLoop(next);
});
el.loop.addEventListener('click', () => {
  if (loop.a === null || loop.b === null) return toast('A, B를 먼저 찍어주세요');
  updateLoop({ ...loop, enabled: !loop.enabled });
});
el.clearAB.addEventListener('click', () => updateLoop({ a: null, b: null, enabled: false }));
document.querySelectorAll<HTMLElement>('[data-nudge]').forEach((b) =>
  b.addEventListener('click', () => {
    const which = b.dataset.nudge as 'a' | 'b';
    loop = nudge(loop, which, Number(b.dataset.d), player?.getDuration() ?? 0);
    // A를 조정하면 바로 들어볼 수 있게 A로 이동
    if (player && which === 'a' && loop.a !== null) player.seek(loop.a);
    // B를 조정하면 B 직전 2초부터 재생해서 끝점 확인
    if (player && which === 'b' && loop.b !== null) player.seek(Math.max(loop.a ?? 0, loop.b - 2));
    renderAB();
  }),
);

// ───────────────────────── 속도 ─────────────────────────

function setRate(r: number) {
  if (!player) return;
  player.setRate(clampRate(r));
  renderRates(clampRate(r));
}

function stepRate(dir: 1 | -1) {
  if (!player) return;
  const cur = player.getRate();
  if (player.fineRate === false) {
    // 세밀 조절 불가 → 지원 목록의 이웃 값으로
    const list = player.getRates();
    const idx = list.findIndex((x) => Math.abs(x - cur) < 0.001);
    const next = list[Math.min(list.length - 1, Math.max(0, idx + dir))];
    if (next !== undefined) setRate(next);
    return;
  }
  setRate(Math.round((cur + dir * 0.05) * 100) / 100);
}

el.rateDown.addEventListener('click', () => stepRate(-1));
el.rateUp.addEventListener('click', () => stepRate(1));
el.rateVal.addEventListener('click', () => setRate(1));

function renderRates(shown?: number) {
  const rate = shown ?? player?.getRate() ?? 1;
  el.rateVal.textContent = rate.toFixed(2) + 'x';
  const list = player?.getRates() ?? [];
  const key = list.join(',');
  if (el.rates.dataset.key !== key) {
    el.rates.dataset.key = key;
    el.rates.replaceChildren(
      ...list.map((r) => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = String(r);
        b.dataset.rate = String(r);
        b.addEventListener('click', () => setRate(r));
        return b;
      }),
    );
  }
  el.rates.querySelectorAll<HTMLElement>('[data-rate]').forEach((b) =>
    b.classList.toggle('on', Math.abs(Number(b.dataset.rate) - rate) < 0.001),
  );
  let note = '';
  if (player?.kind === 'youtube') {
    if (player.fineRate === false) note = '이 영상/기기에선 유튜브가 0.05 단위 배속을 지원하지 않아 위 값들만 됩니다.';
    else if (player.fineRate === true) note = '0.05 단위 배속 확인됨.';
  }
  el.rateNote.textContent = note;
}

// ───────────────────────── 렌더 / 루프 틱 ─────────────────────────

function renderAB() {
  el.timeA.textContent = formatTime(loop.a);
  el.timeB.textContent = formatTime(loop.b);
  el.btnA.classList.toggle('set', loop.a !== null);
  el.btnB.classList.toggle('set', loop.b !== null);
  el.loop.classList.toggle('on', loop.enabled);
  el.loop.setAttribute('aria-pressed', String(loop.enabled));
  el.loop.querySelector('small')!.textContent = loop.enabled ? 'ON' : 'OFF';
  const dur = player?.getDuration() ?? 0;
  if (dur > 0 && loop.a !== null && loop.b !== null) {
    el.abRange.hidden = false;
    el.abRange.style.left = `${(loop.a / dur) * 100}%`;
    el.abRange.style.width = `${((loop.b - loop.a) / dur) * 100}%`;
    el.abRange.classList.toggle('off', !loop.enabled);
  } else el.abRange.hidden = true;
}

function renderAll() {
  const dur = player?.getDuration() ?? 0;
  el.dur.textContent = formatTime(dur, false);
  el.seekbar.max = String(dur);
  el.play.textContent = player?.isPlaying() ? '❚❚' : '▶';
  el.play.setAttribute('aria-label', player?.isPlaying() ? '일시정지' : '재생');
  const title = player?.getTitle();
  if (title) el.title.textContent = title;
  renderAB();
  renderTime();
}

function renderTime() {
  if (!player || seeking) return;
  const t = player.getTime();
  const dur = player.getDuration();
  el.cur.textContent = formatTime(t);
  el.seekbar.value = String(t);
  el.progress.style.width = dur > 0 ? `${Math.min(100, (t / dur) * 100)}%` : '0';
}

/** B 지점 체크. 정밀도가 핵심이라 rAF + 50ms 타이머 양쪽에서 호출 */
function checkLoop() {
  if (!player || !player.isPlaying()) return;
  if (shouldJump(loop, player.getTime())) player.seek(loop.a!);
}

function frame() {
  checkLoop();
  renderTime();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// rAF는 백그라운드 탭에서 멈춤 → 안드로이드에서 화면 꺼진 채 오디오가 나올 때 대비
setInterval(checkLoop, 50);

// 데스크톱 단축키
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (k === 'a') el.btnA.click();
  else if (k === 'b') el.btnB.click();
  else if (k === 'l') el.loop.click();
  else if (k === 'arrowleft') seekBy(-5);
  else if (k === 'arrowright') seekBy(5);
  else if (k === '-') stepRate(-1);
  else if (k === '=' || k === '+') stepRate(1);
});

// ?v=ID 또는 ?url=... 로 열면 바로 로드 (공유/테스트용)
{
  const q = new URLSearchParams(location.search);
  const v = q.get('v') ?? q.get('url') ?? q.get('text');
  if (v) {
    el.url.value = v;
    handleInput(v);
  }
}
renderAll();

// 실기기/자동화 테스트용 디버그 훅 (?debug)
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__dbg = { get player() { return player; }, get loop() { return loop; } };
}
