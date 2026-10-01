/**
 * 事務所端末のデータ置き場（保存先アダプタ）
 * ------------------------------------------------------------------
 * 保存先は Upstash Redis（Vercelの「Storage」からワンクリックで追加できる）。
 * 依存パッケージは使わず、REST API を fetch で叩くだけにしてある。
 *
 * 環境変数（Vercelが自動で入れてくれる。どちらの名前でも動く）：
 *   KV_REST_API_URL / KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * 環境変数が無いときは「保存先が未設定」として何も保存しない（null を返す）。
 * サーバーレス環境でメモリに保存すると、次の呼び出しで消えるため、黙って動かさない。
 * テストと手元の確認では、memoryStore() を明示的に渡す。
 *
 * 値はすべて文字列で保存する（JSONは呼び出し側で変換する）。
 */

/** @typedef {ReturnType<typeof memoryStore>} Store */

export function configuredStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return upstashStore(url, token);
}

/* ------------------------------------------------------------------
 * Upstash Redis（REST）
 * ------------------------------------------------------------------ */
export function upstashStore(url, token) {
  const base = url.replace(/\/$/, '');

  async function cmd(args) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(`store: ${json.error ?? res.status}`);
    return json.result;
  }

  /** HGETALL の返事 [f1,v1,f2,v2…] をオブジェクトにする */
  const pairs = (arr) => {
    const out = {};
    for (let i = 0; i + 1 < (arr?.length ?? 0); i += 2) out[arr[i]] = arr[i + 1];
    return out;
  };

  return {
    kind: 'upstash',
    get: (key) => cmd(['GET', key]),
    set: (key, value, ttlSec) => (ttlSec ? cmd(['SET', key, value, 'EX', String(ttlSec)]) : cmd(['SET', key, value])),
    setIfAbsent: async (key, value) => (await cmd(['SET', key, value, 'NX'])) === 'OK',
    del: (key) => cmd(['DEL', key]),
    mget: async (keys) => (keys.length ? cmd(['MGET', ...keys]) : []),
    hget: (key, field) => cmd(['HGET', key, field]),
    hmget: async (key, fields) => (fields.length ? cmd(['HMGET', key, ...fields]) : []),
    hgetall: async (key) => pairs(await cmd(['HGETALL', key])),
    hset: (key, field, value) => cmd(['HSET', key, field, value]),
    hdel: (key, field) => cmd(['HDEL', key, field]),
    zadd: (key, score, member) => cmd(['ZADD', key, String(score), member]),
    zrem: (key, member) => cmd(['ZREM', key, member]),
    zcard: async (key) => Number(await cmd(['ZCARD', key])),
    /** スコアの大きい順に、min〜max の範囲で offset から limit 件のメンバーを返す */
    zrevrangebyscore: (key, max, min, offset, limit) =>
      cmd(['ZREVRANGEBYSCORE', key, String(max), String(min), 'LIMIT', String(offset), String(limit)]),
    /**
     * 回数を1増やして返す。有効期限は、先に「無ければ作る（NX）」で付けておく。
     * 数える→期限を付ける の順だと、その間に落ちたとき期限のない回数が残り、ロックが永久に解けなくなるため
     */
    incr: async (key, ttlSec) => {
      if (ttlSec) await cmd(['SET', key, '0', 'NX', 'EX', String(ttlSec)]);
      return Number(await cmd(['INCR', key]));
    },
  };
}

/* ------------------------------------------------------------------
 * メモリ（テスト・手元確認専用）
 * ------------------------------------------------------------------ */
/** @param {() => number} [now] テストで時計を進められるように差し替え可能 */
export function memoryStore(now = Date.now) {
  const kv = new Map();      // key -> { v, exp }
  const hashes = new Map();  // key -> Map(field -> value)
  const zsets = new Map();   // key -> Map(member -> score)
  const alive = (e) => e && (!e.exp || e.exp > now());
  const hash = (key) => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  const zset = (key) => { if (!zsets.has(key)) zsets.set(key, new Map()); return zsets.get(key); };

  return {
    kind: 'memory',
    async get(key) { const e = kv.get(key); return alive(e) ? e.v : null; },
    async set(key, value, ttlSec) { kv.set(key, { v: String(value), exp: ttlSec ? now() + ttlSec * 1000 : 0 }); return 'OK'; },
    async setIfAbsent(key, value) {
      if (alive(kv.get(key))) return false;
      kv.set(key, { v: String(value), exp: 0 });
      return true;
    },
    async del(key) { const had = kv.delete(key); hashes.delete(key); zsets.delete(key); return had ? 1 : 0; },
    async mget(keys) { return keys.map((k) => { const e = kv.get(k); return alive(e) ? e.v : null; }); },
    async hget(key, field) { return hashes.get(key)?.get(field) ?? null; },
    async hmget(key, fields) { const h = hashes.get(key); return fields.map((f) => h?.get(f) ?? null); },
    async hgetall(key) { return Object.fromEntries(hashes.get(key) ?? []); },
    async hset(key, field, value) { hash(key).set(field, String(value)); return 1; },
    async hdel(key, field) { return hash(key).delete(field) ? 1 : 0; },
    async zadd(key, score, member) { zset(key).set(member, Number(score)); return 1; },
    async zrem(key, member) { return zset(key).delete(member) ? 1 : 0; },
    async zcard(key) { return zsets.get(key)?.size ?? 0; },
    async zrevrangebyscore(key, max, min, offset, limit) {
      const hi = max === '+inf' ? Infinity : Number(max);
      const lo = min === '-inf' ? -Infinity : Number(min);
      return [...zset(key).entries()]
        .filter(([, s]) => s <= hi && s >= lo)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
        .slice(offset, offset + limit)
        .map(([m]) => m);
    },
    async incr(key, ttlSec) {
      const e = kv.get(key);
      const n = (alive(e) ? Number(e.v) : 0) + 1;
      kv.set(key, { v: String(n), exp: alive(e) ? e.exp : (ttlSec ? now() + ttlSec * 1000 : 0) });
      return n;
    },
  };
}
