package com.terra.kensyuu.ui.measurement

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R
import com.terra.kensyuu.data.repository.DiameterSubtotal
import com.terra.kensyuu.ui.theme.TerraExtraColors
import com.terra.kensyuu.util.VolumeFormat
import java.math.BigDecimal
import kotlinx.coroutines.delay

private val MIN_CARD_HEIGHT = 52.dp
private val MAX_CARD_HEIGHT = 104.dp

/**
 * セットアップで指定した範囲の径級のみを動的に表示するグリッド。範囲径級数が
 * 少なければ利用可能な高さいっぱいまでカードを大きく、多ければ最小高さに収めて
 * スクロールを許容する（1画面によりを多くの径級を収めることを最優先）。
 */
@Composable
fun DiameterGrid(
    diameters: List<Int>,
    subtotals: Map<Int, DiameterSubtotal>,
    onTap: (Int) -> Unit,
    onLongPressUndo: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val idealHeight = if (diameters.isNotEmpty()) maxHeight / diameters.size else MAX_CARD_HEIGHT
        val cardHeight = idealHeight.coerceIn(MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            items(diameters, key = { it }) { diameter ->
                val subtotal = subtotals[diameter]
                DiameterCard(
                    diameterCm = diameter,
                    count = subtotal?.activeCount ?: 0,
                    volume = subtotal?.subtotalVolume ?: BigDecimal.ZERO.setScale(4),
                    height = cardHeight,
                    onTap = { onTap(diameter) },
                    onLongPress = { onLongPressUndo(diameter) }
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DiameterCard(
    diameterCm: Int,
    count: Int,
    volume: BigDecimal,
    height: Dp,
    onTap: () -> Unit,
    onLongPress: () -> Unit
) {
    var flashTrigger by remember { mutableIntStateOf(0) }
    var flashing by remember { mutableIntStateOf(0) }
    LaunchedEffect(flashTrigger) {
        if (flashTrigger == 0) return@LaunchedEffect
        flashing = flashTrigger
        delay(150)
        if (flashing == flashTrigger) flashing = 0
    }
    val targetColor = if (flashing != 0) TerraExtraColors.cardFlash else TerraExtraColors.cardDefault
    val backgroundColor by animateColorAsState(targetColor, label = "cardFlash")

    val cardCd = stringResource(
        R.string.measure_diameter_card_cd,
        diameterCm,
        count,
        VolumeFormat.format(volume)
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .height(height)
            .semantics { contentDescription = cardCd }
            .combinedClickable(
                onClick = {
                    flashTrigger++
                    onTap()
                },
                onLongClick = onLongPress
            ),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = backgroundColor),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "$diameterCm${stringResource(R.string.measure_diameter_unit_suffix)}",
                style = MaterialTheme.typography.headlineMedium,
                color = TerraExtraColors.cardDefaultText
            )
            Text(
                text = "${count}${stringResource(R.string.measure_unit_count)}",
                style = MaterialTheme.typography.headlineMedium,
                color = TerraExtraColors.cardDefaultText
            )
            Text(
                text = "${VolumeFormat.format(volume)}${stringResource(R.string.measure_unit_volume)}",
                style = MaterialTheme.typography.titleLarge,
                color = TerraExtraColors.cardDefaultText
            )
        }
    }
}
