package com.terra.kensyuu.ui.measurement

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R
import com.terra.kensyuu.data.db.entity.SlipLineEntity
import com.terra.kensyuu.ui.theme.TerraExtraColors

/**
 * 入力履歴（タップ・音声どちらの入力も同じ表示ルール）。取消済みは履歴から
 * 消さず、薄いグレー＋取り消し線で残す。競合アプリの「取消すると何を取り消したか
 * 分からなくなる」という欠陥を解消するための表示。
 */
@Composable
fun HistoryStrip(lines: List<SlipLineEntity>, modifier: Modifier = Modifier) {
    val listState = rememberLazyListState()
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) listState.animateScrollToItem(lines.size - 1)
    }

    if (lines.isEmpty()) {
        Text(
            stringResource(R.string.measure_history_empty),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier
        )
        return
    }

    LazyRow(
        state = listState,
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(lines, key = { it.id }) { line ->
            val cancelledColor = TerraExtraColors.cancelledText
            Text(
                text = "${line.diameterCm}${stringResource(R.string.measure_diameter_unit_suffix)}",
                style = MaterialTheme.typography.bodyLarge,
                color = if (line.cancelled) cancelledColor else MaterialTheme.colorScheme.onSurface,
                textDecoration = if (line.cancelled) TextDecoration.LineThrough else TextDecoration.None,
                modifier = Modifier
                    .background(
                        if (line.cancelled) Color.Transparent else MaterialTheme.colorScheme.surfaceVariant,
                        MaterialTheme.shapes.small
                    )
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}
