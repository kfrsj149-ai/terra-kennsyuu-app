package com.terra.kensyuu.calc

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/**
 * JAS (日本農林規格) 丸太材積計算エンジン。
 *
 * 規格長さ L (m) が 6m 未満か以上かで計算式が自動的に切り替わる。呼び出し側は
 * 長さと径級を渡すだけでよく、短尺式・長尺式の分岐を意識する必要はない。
 *
 *   L < 6m:
 *     D < 14  -> V = D^2 * L / 10000                       （径級補正なし）
 *     D >= 14 -> V = (D + (L-4)/2)^2 * L / 10000
 *   L >= 6m:
 *     D >= 14 -> p = (L-4)/2 + (D-12)/2 ; V = (D + p)^2 * L / 10000
 *     D < 14  -> V = (D + (L-4)/2)^2 * L / 10000
 *
 * 長尺材（L>=6m）で D>=14cm の径級補正 (D-12)/2 を欠落させると、競合アプリと
 * 同じ過小評価バグ（本アプリのテストケースでは 166.698m³ が誤って 92.112m³ に
 * なる、約44.74%の過小評価）を再現してしまうため、この分岐は特に注意深く扱う。
 *
 * 結果は四捨五入ではなく小数第4位以下切り捨て。
 */
object JasVolumeCalculator {

    private val MC = MathContext(50)
    private val TWO: BigDecimal = BigDecimal(2)
    private val FOUR: BigDecimal = BigDecimal(4)
    private val SIX: BigDecimal = BigDecimal(6)
    private val TWELVE: BigDecimal = BigDecimal(12)
    private val TEN_THOUSAND: BigDecimal = BigDecimal(10000)
    private const val SHORT_LENGTH_CORRECTION_MIN_DIAMETER = 14

    /**
     * 1本分の材積 (m³) を計算する。結果は小数第4位以下切り捨て済み。
     *
     * @param diameterClassCm 径級 (cm)。正の整数。
     * @param lengthMeters 規格長さ (m)。正の値、小数点以下2桁まで想定。
     */
    fun calculateVolume(diameterClassCm: Int, lengthMeters: BigDecimal): BigDecimal {
        require(diameterClassCm > 0) { "diameterClassCm must be positive: $diameterClassCm" }
        require(lengthMeters.signum() > 0) { "lengthMeters must be positive: $lengthMeters" }

        val d = BigDecimal(diameterClassCm)
        val l = lengthMeters
        val isLongMaterial = l >= SIX
        val hasDiameterCorrection = diameterClassCm >= SHORT_LENGTH_CORRECTION_MIN_DIAMETER

        val effectiveDiameter: BigDecimal = when {
            !hasDiameterCorrection && !isLongMaterial ->
                // 短尺材・D<14cm: 補正なし（D 自体を実効径級として使う）
                d
            isLongMaterial && hasDiameterCorrection -> {
                // 長尺材・D>=14cm: 長さ補正に加えて径級補正 (D-12)/2 を上乗せする。
                // ここを短尺式のまま流用すると競合アプリと同じ過小評価バグになる。
                val lengthCorrection = (l - FOUR).divide(TWO, MC)
                val diameterCorrection = (d - TWELVE).divide(TWO, MC)
                d + lengthCorrection + diameterCorrection
            }
            else -> {
                // 短尺材・D>=14cm、または長尺材・D<14cm: 長さ補正のみ
                val lengthCorrection = (l - FOUR).divide(TWO, MC)
                d + lengthCorrection
            }
        }

        // NB: BigDecimal's `/` operator (kotlin-stdlib) calls divide(other, this.scale(),
        // RoundingMode.HALF_EVEN) — since the dividend here has scale 0, that silently
        // rounds to a whole number. Always divide explicitly with a MathContext instead.
        val volume = effectiveDiameter.pow(2, MC).multiply(l, MC).divide(TEN_THOUSAND, MC)
        return truncate4(volume)
    }

    fun calculateVolume(diameterClassCm: Int, lengthMeters: Double): BigDecimal =
        calculateVolume(diameterClassCm, BigDecimal.valueOf(lengthMeters))

    /** 径級ごとの本数から合計材積を求める（小計は各本ごとの切り捨て後に合算）。 */
    fun calculateSubtotal(diameterClassCm: Int, count: Int, lengthMeters: BigDecimal): BigDecimal {
        if (count <= 0) return BigDecimal.ZERO.setScale(4)
        val perLog = calculateVolume(diameterClassCm, lengthMeters)
        return truncate4(perLog * BigDecimal(count))
    }

    private fun truncate4(value: BigDecimal): BigDecimal =
        value.setScale(4, RoundingMode.DOWN)
}
