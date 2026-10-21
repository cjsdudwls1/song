/** localStorage(메타데이터) + IndexedDB(로컬 파일 Blob). 사파리 프라이빗 모드 등에서 실패해도 앱은 돌아가게 전부 try/catch */

export interface Section {
  id: string;
  name: string;
  a: number;
  b: number;
}

export interface Song {
  key: string; // yt:<id> | file:<name>:<size>
  kind: 'youtube' | 'local';
  videoId?: string;
  title: string;
  saved: boolean;
  lastOpened: number;
  sections: Section[];
  rate?: number;
  bpm?: number;
  beatOne?: number; // 8카운트의 "1" 위치(초)
  hasBlob?: boolean;
}

const LS_SONGS = 'dr.songs.v1';
const LS_PREFS = 'dr.prefs.v1';
const MAX_RECENT = 40;
const MAX_BLOBS = 8;

function readJSON<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 용량 초과/프라이빗 모드 → 저장만 포기 */
  }
}

// ───── 곡 목록 ─────

export function listSongs(): Song[] {
  return readJSON<Song[]>(LS_SONGS, []).sort((a, b) => b.lastOpened - a.lastOpened);
}

export function getSong(key: string): Song | undefined {
  return listSongs().find((s) => s.key === key);
}

/** 곡 열 때 호출: 없으면 만들고 lastOpened 갱신 */
export function touchSong(init: Pick<Song, 'key' | 'kind' | 'title'> & Partial<Song>): Song {
  const songs = listSongs();
  let s = songs.find((x) => x.key === init.key);
  if (s) {
    s.lastOpened = Date.now();
    if (init.title && !s.title) s.title = init.title;
    if (init.hasBlob !== undefined) s.hasBlob = init.hasBlob;
  } else {
    s = { saved: false, sections: [], ...init, lastOpened: Date.now() };
    songs.unshift(s);
  }
  persist(songs);
  return s;
}

export function updateSong(key: string, patch: Partial<Song>): Song | undefined {
  const songs = listSongs();
  const s = songs.find((x) => x.key === key);
  if (!s) return undefined;
  Object.assign(s, patch);
  persist(songs);
  return s;
}

export function removeSong(key: string) {
  persist(listSongs().filter((s) => s.key !== key));
  void deleteBlob(key);
}

function persist(songs: Song[]) {
  // 저장 안 한 최근 곡은 개수 제한 (구간이 있으면 보존)
  songs.sort((a, b) => b.lastOpened - a.lastOpened);
  const keep: Song[] = [];
  let recent = 0;
  for (const s of songs) {
    if (s.saved || s.sections.length) keep.push(s);
    else if (recent++ < MAX_RECENT) keep.push(s);
    else if (s.hasBlob) void deleteBlob(s.key);
  }
  // 로컬 파일 Blob은 용량이 커서 최근 N개만
  let blobs = 0;
  for (const s of keep) {
    if (!s.hasBlob) continue;
    if (++blobs > MAX_BLOBS && !s.saved) {
      s.hasBlob = false;
      void deleteBlob(s.key);
    }
  }
  writeJSON(LS_SONGS, keep);
}

// ───── 설정 ─────

export interface Prefs {
  mirror: boolean;
  wakeLock: boolean;
  showCount: boolean;
  countIn: boolean;
}
const DEFAULT_PREFS: Prefs = { mirror: false, wakeLock: true, showCount: false, countIn: false };

export function getPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...readJSON<Partial<Prefs>>(LS_PREFS, {}) };
}
export function setPrefs(p: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...p };
  writeJSON(LS_PREFS, next);
  return next;
}

// ───── IndexedDB: 로컬 파일 ─────

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('dance-replayer', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction('files', mode);
        const req = fn(t.objectStore('files'));
        t.oncomplete = () => resolve(req.result);
        t.onerror = t.onabort = () => reject(t.error);
      }),
  );
}

export interface StoredFile {
  blob: Blob;
  name: string;
}

export async function putBlob(key: string, file: StoredFile): Promise<boolean> {
  try {
    // iOS 사파리는 File 객체를 그대로 넣으면 실패하는 버전이 있어 ArrayBuffer→Blob으로 복사
    const blob = new Blob([await file.blob.arrayBuffer()], { type: file.blob.type });
    await tx('readwrite', (s) => s.put({ blob, name: file.name }, key));
    return true;
  } catch {
    return false;
  }
}

export async function getBlob(key: string): Promise<StoredFile | null> {
  try {
    return ((await tx('readonly', (s) => s.get(key))) as StoredFile | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function deleteBlob(key: string) {
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    /* noop */
  }
}
