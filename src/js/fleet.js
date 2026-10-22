/**
 * 車番の「使用中／休み」と契約台数
 * ------------------------------------------------------------------
 * 契約台数まで数えるのは「いま使用中」の車番だけ。登録は無制限。
 * 予備車や車検・修理の代車は「休み」にしておき、使うときに入れ替える。
 * 数えるのは「頭」（トラクタ／トラック）。トレーラーは数えない。
 * 契約台数（seats）が分からないとき（試用中など）は、制限しない。
 * 計測は、どんな場合も止めない（止めるのは、使用中の車番を契約台数より増やす操作だけ）。
 */

/** 休みの車番か。resting が無い古い登録は、使用中として扱う */
export const isResting = (option) => Boolean(option?.resting);

export const activeOf = (options) => (options ?? []).filter((o) => !isResting(o));

/** 契約台数。正の整数でなければ null（制限しない） */
export function seatsOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 使用中の車番を、もう1台増やせるか */
export function hasRoom(options, seats) {
  const limit = seatsOf(seats);
  return limit === null || activeOf(options).length < limit;
}

/** 新しく登録する車番を、休みで登録すべきか（登録は止めず、台数がいっぱいなら休みにする） */
export const registerAsResting = (options, seats) => !hasRoom(options, seats);

/**
 * 休みの車番を使うときの段取り。
 *  - 空きがある → そのまま使用中にする
 *  - いっぱい   → 休ませる車を選んでもらう（候補は、いま使用中の車）
 */
export function planActivate(options, id, seats) {
  const target = (options ?? []).find((o) => o.id === id);
  if (!target || !isResting(target)) return { kind: 'noop' };
  if (hasRoom(options, seats)) return { kind: 'activate' };
  return { kind: 'swap', candidates: activeOf(options) };
}
