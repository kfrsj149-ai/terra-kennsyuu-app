package com.terra.kensyuu.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R

/**
 * 生年月日選択のような▲▼ピッカー。径級は2cm刻みの制約があるため、
 * 自由なテキスト入力ではなくこのステッパーで選択させる。
 */
@Composable
fun DiameterStepper(
    label: String,
    valueCm: Int,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    isError: Boolean = false,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .background(
                if (isError) MaterialTheme.colorScheme.error.copy(alpha = 0.08f)
                else MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.medium
            )
            .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(text = label, style = MaterialTheme.typography.labelLarge)
        IconButton(onClick = onIncrement, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Filled.KeyboardArrowUp, contentDescription = null)
        }
        Text(
            text = "$valueCm${stringResource(R.string.measure_diameter_unit_suffix)}",
            style = MaterialTheme.typography.headlineMedium
        )
        IconButton(onClick = onDecrement, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null)
        }
    }
}

@Composable
fun DiameterRangeStepperRow(
    minValueCm: Int,
    maxValueCm: Int,
    onMinIncrement: () -> Unit,
    onMinDecrement: () -> Unit,
    onMaxIncrement: () -> Unit,
    onMaxDecrement: () -> Unit,
    isError: Boolean,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        DiameterStepper(
            label = stringResource(R.string.setup_diameter_min),
            valueCm = minValueCm,
            onIncrement = onMinIncrement,
            onDecrement = onMinDecrement,
            isError = isError,
            modifier = Modifier
        )
        DiameterStepper(
            label = stringResource(R.string.setup_diameter_max),
            valueCm = maxValueCm,
            onIncrement = onMaxIncrement,
            onDecrement = onMaxDecrement,
            isError = isError,
            modifier = Modifier
        )
    }
}
