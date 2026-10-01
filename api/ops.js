/**
 * POST /api/ops
 * ------------------------------------------------------------------
 * 運営者コンソール（/ops/）の入口。運営者の鍵（環境変数 OPERATOR_KEY）が無いときは何も動かない。
 * 操作の一覧と、守っていること（閲覧専用・閲覧記録・匿名化）は _ops-core.js の冒頭を参照。
 */
import { readBody, json, rejectNonPost } from './_lib.js';
import { createOps } from './_ops-core.js';
import { configuredStore } from './_office-store.js';

let ops = null;

/** テスト・手元確認用：保存先や鍵を差し替えた本体を使う */
export function __setOpsForTests(instance) { ops = instance; }

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  if (!ops) ops = createOps({ store: configuredStore() });
  const body = await readBody(req);
  // ログインの試行回数をIPごとに数えるため。Vercelは x-forwarded-for に接続元を入れる
  const ip = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const { status, payload } = await ops.handle(body, { ip });
  return json(res, status, payload);
}
