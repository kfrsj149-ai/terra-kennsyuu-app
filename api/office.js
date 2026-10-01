/**
 * POST /api/office
 * ------------------------------------------------------------------
 * 事務所端末まわりの入口（1つの関数に束ねてある）。
 * body は { op: 'feed' | 'ticket.put' | … , …引数 }。操作の一覧と権限は _office-core.js を参照。
 *
 * Vercelの無料プランは関数を12個までしか置けないため、操作ごとに別ファイルにせず
 * この1つに集めている。
 *
 * 保存先（Upstash Redis）の環境変数が無いときは { ok:false, error:'not_configured' } を返すだけで、
 * 何も保存しない。
 */
import { readBody, json, rejectNonPost } from './_lib.js';
import { createOffice } from './_office-core.js';
import { configuredStore } from './_office-store.js';

let office = null;

/** テスト用：保存先などを差し替えた本体を使う */
export function __setOfficeForTests(instance) { office = instance; }

export default async function handler(req, res) {
  if (rejectNonPost(req, res)) return;
  if (!office) office = createOffice({ store: configuredStore() });
  const body = await readBody(req);
  const { status, payload } = await office.handle(body);
  return json(res, status, payload);
}
