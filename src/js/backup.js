/**
 * Googleドライブ自動バックアップ
 * ------------------------------------------------------------------
 * オフライン思想とは矛盾しない「通信可能な時だけ動く裏処理」として実装する。
 * 端末の故障・紛失に備えて IndexedDB の内容を1日1回アップロードする。
 * CONFIG.googleDrive.clientId が未設定の配布では機能全体が自動的に無効になる。
 */
import { CONFIG } from './config.js';
import { kvGet, kvSet, listTickets, listPresets, listOptions, saveTicket, listPendingTickets } from './db.js';

const TOKEN_KEY = 'driveToken';
const META_KEY = 'driveMeta';
const FILE_NAME = 'terra-kennsyuu-backup.json';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export function isConfigured() {
  return Boolean(CONFIG.googleDrive.clientId);
}

let gisPromise = null;
function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('GIS load failed'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

async function getToken({ interactive }) {
  const saved = await kvGet(TOKEN_KEY, null);
  if (saved && saved.expiresAt > Date.now() + 60_000) return saved.token;
  if (!navigator.onLine) return null;
  await loadGis();
  return new Promise((resolve) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleDrive.clientId,
      scope: CONFIG.googleDrive.scope,
      prompt: interactive ? 'consent' : '',
      callback: async (resp) => {
        if (!resp?.access_token) { resolve(null); return; }
        await kvSet(TOKEN_KEY, {
          token: resp.access_token,
          expiresAt: Date.now() + (Number(resp.expires_in) || 3000) * 1000,
        });
        resolve(resp.access_token);
      },
      error_callback: () => resolve(null),
    });
    client.requestAccessToken();
  });
}

/** 利用者が明示的に接続する（初回のみ同意画面が出る） */
export async function connect() {
  if (!isConfigured()) return { ok: false, error: 'unconfigured' };
  const token = await getToken({ interactive: true });
  return token ? { ok: true } : { ok: false, error: 'denied' };
}

export async function disconnect() {
  await kvSet(TOKEN_KEY, null);
  await kvSet(META_KEY, { ...(await kvGet(META_KEY, {})), connected: false });
}

export async function status() {
  const meta = await kvGet(META_KEY, {});
  const token = await kvGet(TOKEN_KEY, null);
  return {
    configured: isConfigured(),
    connected: Boolean(token) || Boolean(meta.connected),
    lastBackupAt: meta.lastBackupAt ?? null,
  };
}

/** バックアップ対象のスナップショットを作る */
async function snapshot() {
  const [tickets, presets, companies, trucks, sites, destinations] = await Promise.all([
    listTickets(10_000), listPresets(),
    listOptions('company'), listOptions('truck'), listOptions('site'), listOptions('destination'),
  ]);
  return {
    app: 'terra-kennsyuu-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    tickets, presets,
    options: { companies, trucks, sites, destinations },
  };
}

async function driveFetch(token, path, init = {}) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`drive ${res.status}`);
  return res.json();
}

async function findFileId(token) {
  const meta = await kvGet(META_KEY, {});
  if (meta.fileId) return meta.fileId;
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const json = await driveFetch(token, `/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
  return json.files?.[0]?.id ?? null;
}

async function uploadSnapshot(token, data) {
  const fileId = await findFileId(token);
  const boundary = `terra${Date.now()}`;
  const metadata = { name: FILE_NAME, mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  const path = fileId
    ? `/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id`
    : '/upload/drive/v3/files?uploadType=multipart&fields=id';
  const json = await driveFetch(token, path, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return json.id;
}

/**
 * バックアップと同期を実行する。
 * 成功したら未同期(pending)の伝票を synced に更新する。
 * @param {{force?: boolean}} opts
 */
export async function runBackup({ force = false } = {}) {
  if (!isConfigured() || !navigator.onLine) return { skipped: true };
  const meta = await kvGet(META_KEY, {});
  const intervalMs = CONFIG.googleDrive.intervalHours * 3_600_000;
  if (!force && meta.lastBackupAt && Date.now() - meta.lastBackupAt < intervalMs) {
    const pending = await listPendingTickets();
    if (pending.length === 0) return { skipped: true };
  }
  const token = await getToken({ interactive: false });
  if (!token) return { skipped: true, reason: 'no-token' };

  try {
    const data = await snapshot();
    const fileId = await uploadSnapshot(token, data);
    const syncedAt = Date.now();
    const pending = await listPendingTickets();
    for (const ticket of pending) {
      await saveTicket({ ...ticket, syncState: 'synced', syncedAt });
    }
    await kvSet(META_KEY, { ...meta, fileId, connected: true, lastBackupAt: syncedAt, lastError: null });
    return { ok: true, synced: pending.length };
  } catch (err) {
    await kvSet(META_KEY, { ...meta, lastError: String(err), lastErrorAt: Date.now() });
    return { ok: false, error: String(err) };
  }
}

/**
 * オンライン復帰時に自動で同期を試みる仕組みを起動する。
 * 失敗しても未同期データは消さず、次の機会に再試行する。
 */
export function initAutoSync() {
  if (!isConfigured()) return;
  const attempt = () => { runBackup().catch(() => {}); };
  window.addEventListener('online', attempt);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') attempt();
  });
  setTimeout(attempt, 5_000);
  setInterval(attempt, 30 * 60_000);
}
