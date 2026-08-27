package com.terra.kensyuu.ui.measurement

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.db.entity.SlipLineEntity
import com.terra.kensyuu.data.repository.SlipTotals
import com.terra.kensyuu.util.VolumeFormat

/**
 * 画面上部のダッシュボード。仕様上「画面全体の高さの3分の2以下」に収め、文字は
 * 下部の径級ボタンより小さくする（ボタンを最優先で大きく表示する設計思想）。
 * 車番・現場・出荷・日付はここには一切表示しない（バックグラウンドで記録のみ）。
 */
@Composable
fun MeasurementDashboard(
    slip: SlipEntity,
    totals: SlipTotals,
    lines: List<SlipLineEntity>,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = "${slip.species}　${slip.lengthCm / 100}." +
                "${(slip.lengthCm % 100).toString().padStart(2, '0')}m　" +
                "${slip.minDiameterCm}-${slip.maxDiameterCm}cm",
            style = MaterialTheme.typography.bodyMedium
        )
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Column {
                Text(
                    stringResource(R.string.measure_total_count_label),
                    style = MaterialTheme.typography.labelLarge
                )
                Text(
                    "${totals.totalCount}${stringResource(R.string.measure_unit_count)}",
                    style = MaterialTheme.typography.titleLarge
                )
            }
            Column {
                Text(
                    stringResource(R.string.measure_total_volume_label),
                    style = MaterialTheme.typography.labelLarge
                )
                Text(
                    "${VolumeFormat.format(totals.totalVolume)}${stringResource(R.string.measure_unit_volume)}",
                    style = MaterialTheme.typography.titleLarge
                )
            }
        }
        Text(stringResource(R.string.measure_history_title), style = MaterialTheme.typography.labelLarge)
        HistoryStrip(lines = lines, modifier = Modifier.fillMaxWidth())
    }
}
