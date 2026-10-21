import './style.css';
import { parseLink } from './url';
import { LocalPlayer, YouTubePlayer, clampRate, type Player, type PlayerEvents } from './player';
import { formatTime, nudge, setA, setB, shouldJump, type LoopState } from './loop';
import * as store from './storage';
import { BpmTapper, countIn, eightCount, songBpm, unlockAudio } from './count';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  url: $<HTMLInputElement>('url'),
  paste: $('paste'),
  file: $<HTMLInputElement>('file'),
  notice: $('notice'),
  stageWrap: $('stageWrap'),
  stage: $('stage'),
  countBig: $('countBig'),
  title: $('title'),
  star: $('star'),
  mirror: $('mirror'),
  wake: $('wake'),
  seekbar: $<HTMLInputElement>('seekbar'),
  progress: $('progress'),
  abRange: $('abRange'),
  cur: $('cur'),
  count: $('count'),
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
  sectionList: $('sectionList'),
  sectionNames: $('sectionNames'),
  tap: $('tap'),
  bpm: $('bpm'),
  bpmUp: $('bpmUp'),
  bpmDown: $('bpmDown'),
  setOne: $('setOne'),
  showCount: $('showCount'),
  countIn: $('countIn'),
  songList: $('songList'),
  toast: $('toast'),
};

let player: Player | null = null;
let song: store.Song | null = null; // 현재 곡의 저장 정보
let loop: LoopState = { a: null, b: null, enabled: false };
let seeking = false; // 시크바 드래그 중
let prefs = store.getPrefs();

// ───────────────────────── 공통 UI ─────────────────────────

function showNotice(html: string | null) {
  el.notice.hidden = !html;
  el.notice.innerHTML = html ?? '';
}

let toastTimer = 0;
function toast(msg: string) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.toast.hidden = true), 2200);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function patchSong(patch: Partial<store.Song>) {
  if (!song) return;
  song = store.updateSong(song.key, patch) ?? { ...song, ...patch };
}

// ───────────────────────── 로딩 ─────────────────────────

function makeEvents(): PlayerEvents {
  return {
    onReady: () => {
      // 이 곡에서 마지막으로 쓰던 배속 복원
      if (song?.rate && song.rate !== 1) player?.setRate(song.rate);
      syncTitle();
      renderRates();
      renderAll();
    },
    onStateChange: () => {
      syncTitle();
      renderAll();
      if (player?.isPlaying()) void acquireWakeLock();
    },
    onRateChange: () => renderRates(),
    onError: (code) => handleError(code),
  };
}

function resetSession() {
  cancelCountIn?.();
  player?.destroy();
  player = null;
  song = null;
  loop = { a: null, b: null, enabled: false };
  showNotice(null);
  el.title.textContent = '';
  el.stageWrap.classList.remove('empty');
}

function loadYouTube(videoId: string, start?: number) {
  if (player?.kind === 'youtube' && (player as YouTubePlayer).videoId === videoId) return;
  resetSession();
  el.stageWrap.classList.remove('compact');
  song = store.touchSong({ key: 'yt:' + videoId, kind: 'youtube', videoId, title: '' });
  player = new YouTubePlayer(el.stage, videoId, makeEvents(), start);
  if (song.title) el.title.textContent = song.title;
  else void fetchOEmbedTitle(videoId);
  afterLoad();
}

async function loadFile(file: Blob, name: string, key = `file:${name}:${file.size}`, persist = true) {
  resetSession();
  const p = new LocalPlayer(el.stage, file, name, makeEvents());
  el.stageWrap.classList.toggle('compact', p.el.tagName === 'AUDIO');
  player = p;
  song = store.touchSong({ key, kind: 'local', title: name });
  el.title.textContent = name;
  afterLoad();
  if (persist && (await store.putBlob(key, { blob: file, name }))) {
    patchSong({ hasBlob: true });
    renderLibrary();
  }
}

function afterLoad() {
  bpmTapper = new BpmTapper();
  renderAll();
  renderSections();
  renderCount();
  renderLibrary();
}

async function openSong(s: store.Song) {
  if (s.kind === 'youtube' && s.videoId) {
    el.url.value = `https://youtu.be/${s.videoId}`;
    loadYouTube(s.videoId);
    return;
  }
  const f = s.hasBlob ? await store.getBlob(s.key) : null;
  if (f) await loadFile(f.blob, f.name, s.key, false);
  else {
    toast('파일이 저장돼 있지 않아요. 다시 열어주세요');
    el.file.click();
  }
}

function syncTitle() {
  const t = player?.getTitle();
  if (!t || !song) return;
  el.title.textContent = t;
  if (song.title !== t) {
    patchSong({ title: t });
    renderLibrary();
  }
}

async function fetchOEmbedTitle(videoId: string) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`,
    );
    if (!r.ok) return;
    const j = (await r.json()) as { title?: string };
    if (j.title && song?.videoId === videoId && !song.title) {
      patchSong({ title: j.title });
      el.title.textContent = j.title;
      renderLibrary();
    }
  } catch {
    /* 제목은 플레이어 API에서도 받음 */
  }
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
      msg = player?.kind === 'local' ? '이 파일 형식은 이 브라우저에서 재생할 수 없어요.' : `재생 오류 (${code})`;
  }
  showNotice(`${msg}<br>${ytLink}`);
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
  if (f) void loadFile(f, f.name);
  el.file.value = '';
});

// ───────────────────────── 재생 컨트롤 ─────────────────────────

let cancelCountIn: (() => void) | null = null;

function togglePlay() {
  if (!player) return;
  if (cancelCountIn) {
    cancelCountIn();
    return;
  }
  if (player.isPlaying()) return player.pause();

  // 반복 구간 밖에서 재생 누르면 A부터
  const t = player.getTime();
  if (loop.enabled && loop.a !== null && loop.b !== null && (t < loop.a - 0.05 || t >= loop.b)) player.seek(loop.a);

  if (prefs.countIn) startCountIn();
  else player.play();
}

function startCountIn() {
  const p = player!;
  const bpm = song?.bpm ?? 120;
  if (!song?.bpm) toast('BPM이 없어서 120으로 카운트해요');
  // 실제로 들리는 박자 = 원곡 BPM × 배속
  const interval = 60 / (bpm * p.getRate());
  const labels = ['5', '6', '7', '8'];
  const finish = () => {
    el.countBig.hidden = true;
    el.countBig.textContent = '';
    cancelCountIn = null;
    renderAll();
  };
  el.countBig.hidden = false;
  const stop = countIn(
    4,
    interval,
    (i) => (el.countBig.textContent = labels[i]),
    () => {
      finish();
      p.play();
      // iOS는 제스처 밖에서 첫 재생이 막힐 수 있음
      setTimeout(() => {
        if (player === p && !p.isPlaying()) toast('재생이 막혔어요. ▶를 한 번 더 눌러주세요');
      }, 1500);
    },
  );
  cancelCountIn = () => {
    stop();
    finish();
  };
  renderAll();
}

function seekBy(d: number) {
  if (!player) return;
  player.seek(Math.max(0, player.getTime() + d));
  renderAll();
}

el.play.addEventListener('click', () => {
  unlockAudio(); // iOS: 제스처 안에서 오디오 컨텍스트 깨우기
  togglePlay();
});
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
  renderSections();
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
    renderSections();
  }),
);

// ───────────────────────── 속도 ─────────────────────────

function setRate(r: number) {
  if (!player) return;
  const rate = clampRate(r);
  player.setRate(rate);
  patchSong({ rate });
  renderRates(rate);
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
        const b = h('button', 'btn', String(r));
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

// ───────────────────────── 구간 북마크 ─────────────────────────

const SECTION_NAMES = ['인트로', '1절', '프리코러스', '후렴', '2절', '브릿지', '댄스브레이크', '아웃트로', '직접 입력'];

el.sectionNames.replaceChildren(
  ...SECTION_NAMES.map((n) => {
    const b = h('button', 'btn small', n === '직접 입력' ? '✎ 직접 입력' : '+ ' + n);
    b.addEventListener('click', () => saveSection(n));
    return b;
  }),
);
el.sectionList.dataset.empty = '저장한 구간이 없어요';

function saveSection(base: string) {
  if (!song || loop.a === null || loop.b === null) return toast('A, B를 먼저 찍어주세요');
  let name = base;
  if (base === '직접 입력') {
    const v = prompt('구간 이름');
    if (!v?.trim()) return;
    name = v.trim();
  }
  // 같은 이름이 있으면 "후렴 2"
  const names = new Set(song.sections.map((s) => s.name));
  if (names.has(name)) {
    let i = 2;
    while (names.has(`${name} ${i}`)) i++;
    name = `${name} ${i}`;
  }
  const sec: store.Section = { id: Date.now().toString(36), name, a: loop.a, b: loop.b };
  const sections = [...song.sections, sec].sort((x, y) => x.a - y.a);
  patchSong({ sections });
  renderSections();
  renderLibrary();
  toast(`"${name}" 저장`);
}

function playSection(s: store.Section) {
  if (!player) return;
  loop = { a: s.a, b: s.b, enabled: true };
  player.seek(s.a);
  if (!player.isPlaying() && !cancelCountIn) {
    if (prefs.countIn) startCountIn();
    else player.play();
  }
  renderAB();
  renderSections();
}

function renderSections() {
  const list = song?.sections ?? [];
  el.sectionList.replaceChildren(
    ...list.map((s) => {
      const row = h('div', 'row');
      const main = h('button', 'btn main');
      const active = loop.enabled && loop.a === s.a && loop.b === s.b;
      main.classList.toggle('active', active);
      const txt = h('span', 'txt');
      txt.append(h('span', 'name', s.name), h('span', 'sub mono', `${formatTime(s.a)} – ${formatTime(s.b)}`));
      main.append(txt);
      main.addEventListener('click', () => playSection(s));
      // 현재 A-B로 덮어쓰기 (미세조정 후 저장용)
      const upd = h('button', 'btn side', '⟳');
      upd.setAttribute('aria-label', '현재 A-B로 덮어쓰기');
      upd.addEventListener('click', () => {
        if (loop.a === null || loop.b === null) return toast('A, B를 먼저 찍어주세요');
        patchSong({ sections: song!.sections.map((x) => (x.id === s.id ? { ...x, a: loop.a!, b: loop.b! } : x)) });
        renderSections();
        toast(`"${s.name}" 갱신`);
      });
      const del = h('button', 'btn side', '✕');
      del.setAttribute('aria-label', '삭제');
      del.addEventListener('click', () => {
        if (!confirm(`"${s.name}" 구간을 삭제할까요?`)) return;
        patchSong({ sections: song!.sections.filter((x) => x.id !== s.id) });
        renderSections();
      });
      row.append(main, upd, del);
      return row;
    }),
  );
}

// ───────────────────────── 곡 라이브러리 ─────────────────────────

let libFilter: 'recent' | 'saved' = 'recent';
el.songList.dataset.empty = '아직 곡이 없어요';

document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    libFilter = b.dataset.filter as typeof libFilter;
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
    renderLibrary();
  }),
);

el.star.addEventListener('click', () => {
  if (!song) return;
  patchSong({ saved: !song.saved });
  renderLibrary();
  toast(song.saved ? '저장됨 ★' : '저장 해제');
});

function renderLibrary() {
  el.star.toggleAttribute('disabled', !song);
  el.star.textContent = song?.saved ? '★' : '☆';
  el.star.setAttribute('aria-pressed', String(!!song?.saved));

  const songs = store.listSongs().filter((s) => libFilter === 'recent' || s.saved);
  el.songList.replaceChildren(
    ...songs.map((s) => {
      const row = h('div', 'row');
      const main = h('button', 'btn main');
      main.classList.toggle('active', s.key === song?.key);
      if (s.kind === 'youtube') {
        const img = h('img', 'thumb');
        img.loading = 'lazy';
        img.alt = '';
        img.src = `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`;
        main.append(img);
      } else main.append(h('span', 'thumb', '♪'));
      const txt = h('span', 'txt');
      const sub = [s.kind === 'local' ? (s.hasBlob ? '내 파일' : '내 파일 · 다시 열기 필요') : '유튜브'];
      if (s.sections.length) sub.push(`구간 ${s.sections.length}`);
      if (s.rate && s.rate !== 1) sub.push(`${s.rate}x`);
      txt.append(h('span', 'name', s.title || s.videoId || '제목 없음'), h('span', 'sub', sub.join(' · ')));
      main.append(txt);
      main.addEventListener('click', () => void openSong(s));
      const star = h('button', 'btn side', s.saved ? '★' : '☆');
      star.setAttribute('aria-label', s.saved ? '저장 해제' : '저장');
      star.addEventListener('click', () => {
        store.updateSong(s.key, { saved: !s.saved });
        if (song?.key === s.key) song = store.getSong(s.key) ?? song;
        renderLibrary();
      });
      const del = h('button', 'btn side', '✕');
      del.setAttribute('aria-label', '목록에서 삭제');
      del.addEventListener('click', () => {
        const extra = s.sections.length ? ` (구간 ${s.sections.length}개도 삭제)` : '';
        if (!confirm(`"${s.title || '이 곡'}"을 목록에서 지울까요?${extra}`)) return;
        store.removeSong(s.key);
        if (song?.key === s.key) song = null;
        renderLibrary();
        renderSections();
      });
      row.append(main, star, del);
      return row;
    }),
  );
}

// ───────────────────────── 카운트 ─────────────────────────

let bpmTapper = new BpmTapper();

el.tap.addEventListener('pointerdown', (e) => {
  e.preventDefault(); // click보다 pointerdown이 지연이 적음
  const bpm = bpmTapper.tap(performance.now());
  if (bpm === null) {
    el.bpm.textContent = '·'.repeat(bpmTapper.count);
    return;
  }
  const rate = player?.isPlaying() ? player.getRate() : 1;
  setBpm(songBpm(bpm, rate));
});
el.bpmUp.addEventListener('click', () => song?.bpm && setBpm(Math.round(song.bpm) + 1));
el.bpmDown.addEventListener('click', () => song?.bpm && setBpm(Math.round(song.bpm) - 1));
el.setOne.addEventListener('click', () => {
  if (!player || !song) return;
  patchSong({ beatOne: Math.round(player.getTime() * 100) / 100 });
  toast(`"1" = ${formatTime(song.beatOne ?? 0)}`);
});
el.showCount.addEventListener('click', () => {
  prefs = store.setPrefs({ showCount: !prefs.showCount });
  if (prefs.showCount && !song?.bpm) toast('먼저 BPM을 탭해주세요');
  renderCount();
});
el.countIn.addEventListener('click', () => {
  prefs = store.setPrefs({ countIn: !prefs.countIn });
  renderCount();
});

function setBpm(bpm: number) {
  if (!song) return toast('곡을 먼저 열어주세요');
  patchSong({ bpm: Math.min(300, Math.max(30, bpm)) });
  renderCount();
}

function renderCount() {
  el.bpm.textContent = song?.bpm ? String(song.bpm) : '--';
  el.showCount.setAttribute('aria-pressed', String(prefs.showCount));
  el.countIn.setAttribute('aria-pressed', String(prefs.countIn));
  el.count.hidden = !(prefs.showCount && song?.bpm);
}

// ───────────────────────── 거울 / 화면 켜두기 ─────────────────────────

el.mirror.addEventListener('click', () => {
  prefs = store.setPrefs({ mirror: !prefs.mirror });
  renderToggles();
});

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };
let wakeLock: WakeLockSentinelLike | null = null;
const wakeSupported = 'wakeLock' in navigator;

async function acquireWakeLock() {
  if (!wakeSupported || !prefs.wakeLock || wakeLock || document.visibilityState !== 'visible') return;
  try {
    const nav = navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<WakeLockSentinelLike> } };
    wakeLock = await nav.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      renderToggles();
    });
  } catch {
    wakeLock = null;
  }
  renderToggles();
}

el.wake.hidden = !wakeSupported;
el.wake.addEventListener('click', async () => {
  prefs = store.setPrefs({ wakeLock: !prefs.wakeLock });
  if (prefs.wakeLock) await acquireWakeLock();
  else {
    await wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
  toast(prefs.wakeLock ? '화면 켜두기 ON' : '화면 켜두기 OFF');
  renderToggles();
});
// 백그라운드 갔다 오면 Wake Lock이 풀림 → 재요청
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && player) void acquireWakeLock();
});

function renderToggles() {
  el.stage.classList.toggle('mirror', prefs.mirror);
  el.mirror.setAttribute('aria-pressed', String(prefs.mirror));
  el.wake.setAttribute('aria-pressed', String(prefs.wakeLock && !!wakeLock));
  el.wake.style.opacity = prefs.wakeLock ? '1' : '0.5';
}

// ───────────────────────── 탭 ─────────────────────────

document.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => {
      x.classList.toggle('on', x === b);
      $(`tab-${x.dataset.tab}`).hidden = x !== b;
    });
    if (b.dataset.tab === 'library') renderLibrary();
  }),
);

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
  const playing = !!player?.isPlaying() || !!cancelCountIn;
  el.play.textContent = playing ? '❚❚' : '▶';
  el.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
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
  if (!el.count.hidden && song?.bpm) {
    el.count.textContent = String(eightCount(t, song.bpm, song.beatOne ?? loop.a ?? 0));
  }
}

/** B 지점 체크. 정밀도가 핵심이라 rAF + 50ms 타이머 양쪽에서 호출 */
function checkLoop() {
  if (!player || !player.isPlaying()) return;
  if (shouldJump(loop, player.getTime())) player.seek(loop.a!);
}

let lastPlaying = false;
function frame() {
  checkLoop();
  renderTime();
  // 상태 이벤트를 놓쳐도 재생 버튼이 맞게 표시되도록
  const playing = !!player?.isPlaying();
  if (playing !== lastPlaying) {
    lastPlaying = playing;
    renderAll();
  }
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

// ?v=ID / ?url=... / 안드로이드 공유(share_target: ?text=...)로 열면 바로 로드
{
  const q = new URLSearchParams(location.search);
  const v = [q.get('v'), q.get('url'), q.get('text'), q.get('title')].find((x) => x && parseLink(x).kind !== 'unknown');
  if (v) {
    el.url.value = v;
    handleInput(v);
  }
}

// 실기기/자동화 테스트용 디버그 훅 (?debug)
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__dbg = {
    get player() {
      return player;
    },
    get loop() {
      return loop;
    },
  };
}

renderToggles();
renderCount();
renderLibrary();
renderAll();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
