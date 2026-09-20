/**
 * IndexedDB ラッパ（依存ライブラリなし）
 * オフラインファースト設計の土台。入力の都度ここに即時書き込む。
 */

const DB_NAME = 'terra-kennsyuu';
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 設定・下書きなどの単純なキー値
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
      // 事前登録リスト（会社名・車番・現場名・納入先）
      if (!db.objectStoreNames.contains('options')) {
        const s = db.createObjectStore('options', { keyPath: 'id' });
        s.createIndex('kind', 'kind');
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
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const asResult = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/* ------------ kv ------------ */
export async function kvGet(key, fallback = null) {
  const db = await openDb();
  const t = db.transaction('kv', 'readonly');
  const v = await asResult(t.objectStore('kv').get(key));
  return v === undefined ? fallback : v;
}

export async function kvSet(key, value) {
  return tx('kv', 'readwrite', (s) => s.put(value, key));
}

export async function kvDelete(key) {
  return tx('kv', 'readwrite', (s) => s.delete(key));
}

/* ------------ options（事前登録リスト） ------------ */
export async function listOptions(kind) {
  const db = await openDb();
  const t = db.transaction('options', 'readonly');
  const all = await asResult(t.objectStore('options').index('kind').getAll(kind));
  return all.sort((a, b) => a.value.localeCompare(b.value, 'ja'));
}

export async function addOption(kind, value) {
  const item = { id: `${kind}:${value}`, kind, value };
  await tx('options', 'readwrite', (s) => s.put(item));
  return item;
}

export async function removeOption(id) {
  return tx('options', 'readwrite', (s) => s.delete(id));
}

/* ------------ presets（よく使う設定） ------------ */
export async function listPresets() {
  const db = await openDb();
  const t = db.transaction('presets', 'readonly');
  return asResult(t.objectStore('presets').getAll());
}

export async function savePreset(preset) {
  await tx('presets', 'readwrite', (s) => s.put(preset));
  return preset;
}

export async function removePreset(id) {
  return tx('presets', 'readwrite', (s) => s.delete(id));
}

/* ------------ tickets（伝票） ------------ */
export async function listTickets(limit = 200) {
  const db = await openDb();
  const t = db.transaction('tickets', 'readonly');
  const all = await asResult(t.objectStore('tickets').getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function getTicket(id) {
  const db = await openDb();
  const t = db.transaction('tickets', 'readonly');
  return asResult(t.objectStore('tickets').get(id));
}

export async function saveTicket(ticket) {
  await tx('tickets', 'readwrite', (s) => s.put(ticket));
  return ticket;
}

export async function listPendingTickets() {
  const db = await openDb();
  const t = db.transaction('tickets', 'readonly');
  return asResult(t.objectStore('tickets').index('syncState').getAll('pending'));
}
