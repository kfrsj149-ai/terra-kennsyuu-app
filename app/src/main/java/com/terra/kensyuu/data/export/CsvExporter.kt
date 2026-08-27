package com.terra.kensyuu.data.export

import android.content.Context
import android.content.res.Configuration
import com.terra.kensyuu.R
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.repository.SlipTotals
import com.terra.kensyuu.data.settings.AppLanguage
import com.terra.kensyuu.util.LengthFormat
import com.terra.kensyuu.util.VolumeFormat
import java.io.File
import java.io.FileOutputStream
import java.math.BigDecimal
import java.util.Locale

/**
 * 伝票の径級別集計をCSVへ書き出す。ヘッダーは選択言語で出力する（デバイスの現在
 * ロケールではなく、アプリ内で選択された [AppLanguage] を使うため、Context を
 * 対象言語の Configuration でラップしてリソースを取得する）。
 *
 * Excelでの文字化けを避けるためUTF-8 BOM付きで書き出す。
 */
object CsvExporter {

    fun buildCsv(context: Context, language: AppLanguage, slip: SlipEntity, totals: SlipTotals): File {
        val localizedContext = context.createConfigurationContext(
            Configuration(context.resources.configuration).apply {
                setLocale(Locale.forLanguageTag(language.tag))
            }
        )
        fun s(resId: Int) = localizedContext.getString(resId)

        val headers = listOf(
            s(R.string.csv_header_date),
            s(R.string.csv_header_slip_no),
            s(R.string.csv_header_spec_diameter),
            s(R.string.csv_header_spec_length),
            s(R.string.csv_header_diameter),
            s(R.string.csv_header_count),
            s(R.string.csv_header_subtotal_volume),
            s(R.string.csv_header_cumulative_count),
            s(R.string.csv_header_cumulative_volume),
            s(R.string.csv_header_memo)
        )

        val specRange = "${slip.minDiameterCm}-${slip.maxDiameterCm}"
        val lengthDisplay = LengthFormat.cmToDisplayString(slip.lengthCm)
        val memo = slip.memoOutput ?: slip.memoSetup ?: ""

        var cumulativeCount = 0
        var cumulativeVolume = BigDecimal.ZERO.setScale(4)

        val rows = mutableListOf<List<String>>()
        rows.add(headers)
        totals.perDiameter.values
            .filter { it.activeCount > 0 }
            .sortedBy { it.diameterCm }
            .forEach { d ->
                cumulativeCount += d.activeCount
                cumulativeVolume += d.subtotalVolume
                rows.add(
                    listOf(
                        slip.slipDate,
                        slip.slipNumber,
                        specRange,
                        lengthDisplay,
                        d.diameterCm.toString(),
                        d.activeCount.toString(),
                        VolumeFormat.format(d.subtotalVolume),
                        cumulativeCount.toString(),
                        VolumeFormat.format(cumulativeVolume),
                        memo
                    )
                )
            }

        val exportDir = File(context.cacheDir, "exports").apply { mkdirs() }
        val fileName = "TERRA_${slip.slipDate.replace("-", "")}_${slip.slipNumber}.csv"
        val file = File(exportDir, fileName)

        FileOutputStream(file).use { out ->
            out.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())) // UTF-8 BOM
            val csvText = rows.joinToString("\r\n") { row -> row.joinToString(",") { escapeCsv(it) } }
            out.write(csvText.toByteArray(Charsets.UTF_8))
            out.write("\r\n".toByteArray(Charsets.UTF_8))
        }
        return file
    }

    private fun escapeCsv(value: String): String {
        return if (value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            "\"" + value.replace("\"", "\"\"") + "\""
        } else {
            value
        }
    }
}
