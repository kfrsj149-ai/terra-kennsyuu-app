package com.terra.kensyuu.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 「よく使う設定」= 樹種＋規格長さ＋径級範囲の組み合わせ。セットアップ画面の
 * 最上部にショートカットボタンとして表示され、タップ一つで下の入力欄へ反映する。
 *
 * @param lengthCm 規格長さをセンチメートル単位の整数で保持する（例: 4.15m -> 415）。
 *   浮動小数点誤差を避けるため、材積計算に渡す直前にのみ BigDecimal(m) へ変換する。
 * @param label 任意のカスタム表示名。未設定なら樹種・長さ・径級範囲から自動生成した
 *   文字列をボタンラベルとして使う。
 */
@Entity(tableName = "presets")
data class PresetEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val label: String?,
    val species: String,
    val lengthCm: Int,
    val minDiameterCm: Int,
    val maxDiameterCm: Int,
    val createdAt: Long
)
