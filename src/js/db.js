/**
 * IndexedDB ラッパ（依存ライブラリなし）
 * オフラインファースト設計の土台。入力の都度ここに即時書き込む。
 *
 * 【フォールバック】
 * プライベートブラウズやサンドボックス環境など、IndexedDBが使えない端末が現実に存在する。
 * その場合でもアプリが起動しなくなることは避け、メモリ上の一時保管へ自動的に切り替える
 * （＝その場では普通に使えるが、閉じると消える）。isMemoryMode() で画面側に警告を出す。
 */

const DB_NAME = 'terra-kennsyuu';
const DB_VERSION = 1;
const STORES = ['kv', 'options', 'presets', 'tickets'];

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;
let memoryMode = false;
const memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));

export function isMemoryMode() {
  return memoryMode;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      // 設定・下書きなどの単純なキー値
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
      // 事前登録リスト（会社名・車番・現場名・納入先）
      if (!db.objectStoreNames.contains('options')) {
        db.createObjectStore('options', { keyPath: 'id' }).createIndex('kind', 'kind');
      }
      // よく使う設定
      if (!db.objectStoreNames.contains('presets')) {
        db.createObjectStore('presets', { keyPath: 'id' });
      }
      // 出力済み伝票（全件保存・原則削除しない）
      if (!db.objectStoreNames.contains('tickets')) {
        const s = db.createObjectStore('tickets', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('syncState', 'syncState');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

/** IndexedDBが使えなければ null を返し、以降はメモリ動作へ切り替える */
async function getDb() {
  if (memoryMode) return null;
  try {
    return await openDb();
  } catch {
    memoryMode = true;
    return null;
  }
}

const asResult = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** 読み取り。失敗したらメモリ側の値を返す */
async function read(store, fn, memoryFn) {
  const db = await getDb();
  if (!db) return memoryFn();
  try {
    const t = db.transaction(store, 'readonly');
    return await fn(t.objectStore(store));
  } catch {
    memoryMode = true;
    return memoryFn();
  }
}

/** 書き込み。失敗したらメモリ側へ書く（入力を絶対に失わせない） */
async function write(store, fn, memoryFn) {
  const db = await getDb();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        fn(t.objectStore(store));
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      return;
    } catch {
      memoryMode = true;
    }
  }
  memoryFn();
}

/* ------------ kv ------------ */
export async function kvGet(key, fallback = null) {
  const v = await read('kv', (s) => asResult(s.get(key)), () => memory.kv.get(key));
  return v === undefined ? fallback : v;
}

export async function kvSet(key, value) {
  return write('kv', (s) => s.put(value, key), () => memory.kv.set(key, value));
}

export async function kvDelete(key) {
  return write('kv', (s) => s.delete(key), () => memory.kv.delete(key));
}

/* ------------ options（事前登録リスト） ------------ */
export async function listOptions(kind) {
  const all = await read(
    'options',
    (s) => asResult(s.index('kind').getAll(kind)),
    () => [...memory.options.values()].filter((o) => o.kind === kind),
  );
  return all.sort((a, b) => a.value.localeCompare(b.value, 'ja'));
}

export async function addOption(kind, value) {
  const item = { id: `${kind}:${value}`, kind, value };
  await write('options', (s) => s.put(item), () => memory.options.set(item.id, item));
  return item;
}

export async function removeOption(id) {
  return write('options', (s) => s.delete(id), () => memory.options.delete(id));
}

/* ------------ presets（よく使う設定） ------------ */
export async function listPresets() {
  return read('presets', (s) => asResult(s.getAll()), () => [...memory.presets.values()]);
}

export async function savePreset(preset) {
  await write('presets', (s) => s.put(preset), () => memory.presets.set(preset.id, preset));
  return preset;
}

export async function removePreset(id) {
  return write('presets', (s) => s.delete(id), () => memory.presets.delete(id));
}

/* ------------ tickets（伝票） ------------ */
export async function listTickets(limit = 200) {
  const all = await read('tickets', (s) => asResult(s.getAll()), () => [...memory.tickets.values()]);
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function getTicket(id) {
  return read('tickets', (s) => asResult(s.get(id)), () => memory.tickets.get(id));
}

export async function saveTicket(ticket) {
  await write('tickets', (s) => s.put(ticket), () => memory.tickets.set(ticket.id, ticket));
  return ticket;
}

export async function listPendingTickets() {
  return read(
    'tickets',
    (s) => asResult(s.index('syncState').getAll('pending')),
    () => [...memory.tickets.values()].filter((t) => t.syncState === 'pending'),
  );
}
