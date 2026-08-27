package com.terra.kensyuu.util

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * 規格長さの入力欄は「2」と打てば内部的に「2.00m」、「2.15」ならそのまま
 * 「2.15m」として扱う（小数点以下2桁まで）。内部表現は常に lengthCm（cm単位の
 * 整数）に正規化し、材積計算にはここから BigDecimal(m) へ変換して渡す。
 */
object LengthFormat {

    /** ユーザー入力文字列(m)をcm単位の整数へ変換する。無効な入力はnull。 */
    fun parseToCm(input: String): Int? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null
        val value = trimmed.toBigDecimalOrNull() ?: return null
        if (value.signum() <= 0) return null
        val cm = value.multiply(BigDecimal(100))
        // 小数点以下2桁(=1cm)より細かい入力は切り捨てる。
        val rounded = cm.setScale(0, RoundingMode.DOWN)
        return rounded.toInt()
    }

    /** cm単位の整数を "2" や "2.15" のような表示用文字列(mの数値部分)に変換する。 */
    fun cmToDisplayString(lengthCm: Int): String {
        val meters = BigDecimal(lengthCm).divide(BigDecimal(100))
        return meters.stripTrailingZeros().let {
            if (it.scale() < 0) it.setScale(0) else it
        }.toPlainString()
    }

    fun cmToMeters(lengthCm: Int): BigDecimal = BigDecimal(lengthCm).divide(BigDecimal(100))

    private fun String.toBigDecimalOrNull(): BigDecimal? = try {
        BigDecimal(this)
    } catch (e: NumberFormatException) {
        null
    }
}
