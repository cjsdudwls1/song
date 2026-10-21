/** 유튜브 임베드와 로컬 파일을 같은 UI로 다루기 위한 공통 인터페이스 */
export interface Player {
  readonly kind: 'youtube' | 'local';
  play(): void;
  pause(): void;
  isPlaying(): boolean;
  /** 가능한 한 정밀한 현재 시각(초) */
  getTime(): number;
  seek(t: number): void;
  getDuration(): number;
  setRate(r: number): void;
  getRate(): number;
  /** 버튼으로 노출할 배속 목록 */
  getRates(): number[];
  /** 0.05 단위 임의 배속 가능 여부. null = 아직 모름 */
  fineRate: boolean | null;
  getTitle(): string;
  destroy(): void;
}

export interface PlayerEvents {
  onReady(): void;
  onStateChange(): void;
  onError(code: number): void;
  onRateChange?(rate: number): void;
}

export const clampRate = (r: number) => Math.min(2, Math.max(0.25, Math.round(r * 100) / 100));

// ───────────────────────── 로컬 파일 (HTML5 media) ─────────────────────────

const LOCAL_RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25];

export class LocalPlayer implements Player {
  readonly kind = 'local' as const;
  fineRate = true;
  readonly el: HTMLMediaElement;
  private url: string;

  constructor(
    container: HTMLElement,
    file: Blob,
    private title: string,
    ev: PlayerEvents,
  ) {
    const isVideo = file.type.startsWith('video/');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    el.controls = false;
    setPreservesPitch(el);
    this.url = URL.createObjectURL(file);
    el.src = this.url;
    this.el = el;
    container.replaceChildren(el);
    if (!isVideo) {
      container.classList.add('audio-only');
      const label = document.createElement('div');
      label.className = 'audio-label';
      label.textContent = '♪ ' + title;
      container.append(label);
    } else container.classList.remove('audio-only');

    el.addEventListener('loadedmetadata', () => ev.onReady(), { once: true });
    for (const t of ['play', 'pause', 'ended', 'seeked', 'durationchange']) {
      el.addEventListener(t, () => ev.onStateChange());
    }
    el.addEventListener('ratechange', () => ev.onRateChange?.(el.playbackRate));
    el.addEventListener('error', () => ev.onError(el.error?.code ?? -1));
  }

  play() {
    void this.el.play().catch(() => {});
  }
  pause() {
    this.el.pause();
  }
  isPlaying() {
    return !this.el.paused && !this.el.ended;
  }
  getTime() {
    return this.el.currentTime;
  }
  seek(t: number) {
    // fastSeek는 키프레임으로 스냅돼서 부정확 → currentTime 직접 설정
    this.el.currentTime = Math.max(0, t);
  }
  getDuration() {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  setRate(r: number) {
    setPreservesPitch(this.el); // 사파리는 src 바뀌면 초기화되는 경우가 있어 매번 설정
    this.el.playbackRate = clampRate(r);
  }
  getRate() {
    return this.el.playbackRate;
  }
  getRates() {
    return LOCAL_RATES;
  }
  getTitle() {
    return this.title;
  }
  destroy() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    URL.revokeObjectURL(this.url);
    this.el.remove();
  }
}

function setPreservesPitch(el: HTMLMediaElement) {
  const m = el as HTMLMediaElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
  m.preservesPitch = true;
  m.webkitPreservesPitch = true;
  m.mozPreservesPitch = true;
}

// ───────────────────────── 유튜브 IFrame Player API ─────────────────────────

/* 필요한 부분만 최소 타입 선언 */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  getVideoData?(): { title?: string; author?: string };
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('YouTube API 로드 실패'));
    };
    document.head.append(s);
  });
  return apiPromise;
}

const YT_PLAYING = 1;
const YT_BUFFERING = 3;

export class YouTubePlayer implements Player {
  readonly kind = 'youtube' as const;
  fineRate: boolean | null = null;
  private p: YTPlayer | null = null;
  private ready = false;
  private state = -1;
  private rate = 1;
  // getCurrentTime()은 iframe이 postMessage로 보내주는 캐시값이라 갱신 주기가 거칠다.
  // 마지막으로 값이 바뀐 시점부터 경과 시간 × 배속으로 보간해서 정밀도를 올린다.
  private lastRaw = -1;
  private lastRawAt = 0;
  private pendingSeek: { target: number; at: number } | null = null;
  private title = '';

  constructor(
    container: HTMLElement,
    readonly videoId: string,
    private ev: PlayerEvents,
    start = 0,
  ) {
    container.classList.remove('audio-only');
    const host = document.createElement('div');
    container.replaceChildren(host);
    void loadYouTubeApi().then(() => {
      if (!host.isConnected) return; // 로딩 중 다른 곡으로 바뀜
      this.p = new window.YT!.Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          start: Math.floor(start),
          origin: location.origin,
        },
        events: {
          onReady: () => {
            this.ready = true;
            this.title = this.p?.getVideoData?.().title ?? '';
            ev.onReady();
          },
          onStateChange: (e: { data: number }) => {
            this.state = e.data;
            if (!this.title) this.title = this.p?.getVideoData?.().title ?? '';
            ev.onStateChange();
          },
          onPlaybackRateChange: (e: { data: number }) => {
            this.rate = e.data;
            ev.onRateChange?.(e.data);
          },
          onError: (e: { data: number }) => ev.onError(e.data),
        },
      });
    }, () => ev.onError(-2));
  }

  play() {
    this.p?.playVideo();
  }
  pause() {
    this.p?.pauseVideo();
  }
  isPlaying() {
    return this.state === YT_PLAYING || (this.state === YT_BUFFERING && this.pendingSeek !== null);
  }
  getTime() {
    if (!this.ready || !this.p) return 0;
    const raw = this.p.getCurrentTime() ?? 0;
    const now = performance.now();
    const advancing = this.state === YT_PLAYING;

    if (this.pendingSeek) {
      const { target, at } = this.pendingSeek;
      // seekTo 직후엔 캐시가 옛 값을 잠깐 돌려준다 → 목표 근처 값이 올 때까지 목표 기준으로 계산
      if (Math.abs(raw - target) > 0.75 && now - at < 1500) {
        return target + (advancing ? ((now - at) / 1000) * this.rate : 0);
      }
      this.pendingSeek = null;
      this.lastRaw = raw;
      this.lastRawAt = now;
    }
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.lastRawAt = now;
    }
    if (!advancing) return raw;
    // 보간은 최대 0.5초까지만 (멈춤/버퍼링을 못 잡았을 때 폭주 방지)
    const extra = Math.min(0.5, ((now - this.lastRawAt) / 1000) * this.rate);
    return raw + extra;
  }
  seek(t: number) {
    if (!this.p) return;
    const target = Math.max(0, t);
    this.pendingSeek = { target, at: performance.now() };
    this.p.seekTo(target, true);
  }
  getDuration() {
    return this.ready ? this.p?.getDuration() ?? 0 : 0;
  }
  setRate(r: number) {
    if (!this.p) return;
    const want = clampRate(r);
    this.p.setPlaybackRate(want);
    // 지원 안 하는 값이면 유튜브가 가까운 값으로 반올림한다 → 실제 적용값으로 검증
    window.setTimeout(() => {
      if (!this.p) return;
      const got = this.p.getPlaybackRate();
      this.rate = got;
      if (!this.getRates().includes(want)) this.fineRate = Math.abs(got - want) < 0.001;
      this.ev.onRateChange?.(got);
    }, 400);
  }
  getRate() {
    return this.p && this.ready ? this.p.getPlaybackRate() : this.rate;
  }
  getRates() {
    const r = this.ready ? this.p?.getAvailablePlaybackRates() : undefined;
    return r && r.length ? r : [1];
  }
  getTitle() {
    return this.title;
  }
  destroy() {
    try {
      this.p?.destroy();
    } catch {
      /* noop */
    }
    this.p = null;
  }
}
