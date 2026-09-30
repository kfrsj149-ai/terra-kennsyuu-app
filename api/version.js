/**
 * GET /api/version
 * ------------------------------------------------------------------
 * いま配信されている版がどのコミットかを返す。
 * スマホだけで開発するときの生命線。山で「さっきの指示が反映されたか？」を
 * アプリ自身が判定し、古ければキャッシュを捨てて最新を取り直すために使う。
 *
 * VERCEL_GIT_COMMIT_SHA はVercelが自動で入れるシステム環境変数。
 * 自分で登録する必要はない。
 */
import { json } from './_lib.js';

export default function handler(req, res) {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';
  json(res, 200, {
    ok: true,
    sha,
    short: sha.slice(0, 7),
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
    env: process.env.VERCEL_ENV ?? 'local',
  });
}
