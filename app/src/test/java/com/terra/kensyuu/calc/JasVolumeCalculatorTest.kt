package com.terra.kensyuu.calc

import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal
import java.math.RoundingMode

/**
 * JAS計算エンジンの正確性検証。特に「12m材・径級6〜72cmの各1本、合計38本で
 * 合計166.698m³」という仕様書のテストケースは、長尺材(L>=6m)の径級補正
 * (D-12)/2 が正しく適用されているかを確認するための最重要テスト。
 * これを短尺式のまま計算すると92.112m³になり、これは競合アプリ
 * 「Log Counter Plus」の過小評価バグ（約44.74%）と同じ挙動になる。
 */
class JasVolumeCalculatorTest {

    // JAS径級区分: 14cm未満は1cm刻み、14cm以上は2cm刻み -> 38区分。
    private val referenceDiameterClasses: List<Int> = (6..13) + (14..72 step 2)

    /** 競合アプリのバグ（長尺材にも短尺式をそのまま適用）を再現するヘルパー。 */
    private fun buggyShortFormulaVolume(diameterClassCm: Int, lengthMeters: BigDecimal): BigDecimal {
        val mc = java.math.MathContext(50)
        val d = BigDecimal(diameterClassCm)
        val correction = (lengthMeters - BigDecimal(4)).divide(BigDecimal(2), mc)
        val v = (d + correction).pow(2, mc)
            .multiply(lengthMeters, mc)
            .divide(BigDecimal(10000), mc)
        return v.setScale(4, RoundingMode.DOWN)
    }

    @Test
    fun `12m material across 38 diameter classes totals 166_698 cubic meters`() {
        assertEquals(38, referenceDiameterClasses.size)

        val length = BigDecimal("12")
        val total = referenceDiameterClasses
            .map { d -> JasVolumeCalculator.calculateVolume(d, length) }
            .fold(BigDecimal.ZERO) { acc, v -> acc + v }

        assertEquals(BigDecimal("166.6980"), total)
    }

    @Test
    fun `short-formula regression matches the competitor's 44_74pct undercount bug`() {
        val length = BigDecimal("12")
        val correctTotal = referenceDiameterClasses
            .map { d -> JasVolumeCalculator.calculateVolume(d, length) }
            .fold(BigDecimal.ZERO) { acc, v -> acc + v }
        val buggyTotal = referenceDiameterClasses
            .map { d -> buggyShortFormulaVolume(d, length) }
            .fold(BigDecimal.ZERO) { acc, v -> acc + v }

        assertEquals(BigDecimal("166.6980"), correctTotal)
        assertEquals(BigDecimal("92.1120"), buggyTotal)

        val undercountRatio = 1.0 - (buggyTotal.toDouble() / correctTotal.toDouble())
        assertEquals(0.4474, undercountRatio, 0.0001)
    }

    @Test
    fun `short material under 14cm gets no diameter correction`() {
        // L=4m, D=12cm -> V = 12^2 * 4 / 10000 = 0.0576
        assertEquals(BigDecimal("0.0576"), JasVolumeCalculator.calculateVolume(12, BigDecimal("4")))
    }

    @Test
    fun `short material 14cm and above gets length correction only`() {
        // L=4m, D=14cm -> V = (14 + (4-4)/2)^2 * 4 / 10000 = 0.0784
        assertEquals(BigDecimal("0.0784"), JasVolumeCalculator.calculateVolume(14, BigDecimal("4")))
    }

    @Test
    fun `long material 14cm and above gets both length and diameter correction`() {
        // L=6m, D=20cm -> p=(6-4)/2+(20-12)/2=5 -> V=(20+5)^2*6/10000=0.375
        assertEquals(BigDecimal("0.3750"), JasVolumeCalculator.calculateVolume(20, BigDecimal("6")))
    }

    @Test
    fun `truncates to 4 decimal places instead of rounding`() {
        // (17.75)^2*3.5/10000 = 0.110271875 -> truncated 0.1102 (would round to 0.1103)
        assertEquals(BigDecimal("0.1102"), JasVolumeCalculator.calculateVolume(18, BigDecimal("3.5")))
    }

    @Test
    fun `subtotal multiplies the truncated per-log volume by count`() {
        assertEquals(
            BigDecimal("1.8750"),
            JasVolumeCalculator.calculateSubtotal(20, 5, BigDecimal("6"))
        )
    }

    @Test
    fun `subtotal of zero count is zero`() {
        assertEquals(
            BigDecimal("0.0000"),
            JasVolumeCalculator.calculateSubtotal(20, 0, BigDecimal("6"))
        )
    }
}
