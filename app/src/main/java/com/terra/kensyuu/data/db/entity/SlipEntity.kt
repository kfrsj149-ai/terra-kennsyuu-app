package com.terra.kensyuu.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 伝票（1回の計測セッション = 1台のトラック分など）。「計測開始」の確認ダイアログで
 * 「はい」を押した時点でレコードを作成し、以降のタップ・音声入力は即座に
 * [com.terra.kensyuu.data.db.entity.SlipLineEntity] として自動保存される
 * （アプリ強制終了時のデータ消失防止）。
 *
 * [exportedAt] が null の伝票は「未出力（作業中）」を意味し、アプリ起動時に
 * 自動的に計測画面へ復帰できるようにする。データ出力確認ダイアログで「はい」を
 * 押すと [exportedAt] が設定され、伝票履歴一覧の対象になる。
 *
 * @param lengthCm 規格長さ(cm)。[PresetEntity.lengthCm] と同じ理由で整数保持。
 * @param slipDate 伝票番号採番の基準日（"yyyy-MM-dd"）。日付が変わったら
 *   [slipNumber] は "001" からリセットされる。
 * @param slipNumber 表示用伝票番号（"001" 等）。手入力での上書きを許可する。
 */
@Entity(tableName = "slips")
data class SlipEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val slipDate: String,
    val slipNumber: String,
    val species: String,
    val lengthCm: Int,
    val minDiameterCm: Int,
    val maxDiameterCm: Int,
    val truckNumber: String?,
    val siteName: String?,
    val destination: String?,
    val companyName: String?,
    val memoSetup: String?,
    val memoOutput: String?,
    val createdAt: Long,
    val exportedAt: Long?
)
