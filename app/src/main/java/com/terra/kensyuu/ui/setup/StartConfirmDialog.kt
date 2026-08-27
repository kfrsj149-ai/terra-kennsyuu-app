package com.terra.kensyuu.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R
import com.terra.kensyuu.util.LengthFormat

/**
 * 樹種の切替忘れ（例: からまつ専門だが稀に杉を切る際）を防ぐための最終確認。
 * 「はい」を左側、「戻る」を右側に配置する（仕様で明示されたレイアウト）。
 */
@Composable
fun StartConfirmDialog(
    species: String,
    lengthCm: Int,
    minDiameterCm: Int,
    maxDiameterCm: Int,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.start_confirm_title)) },
        text = {
            Text(
                stringResource(
                    R.string.start_confirm_message,
                    species,
                    LengthFormat.cmToDisplayString(lengthCm),
                    minDiameterCm,
                    maxDiameterCm
                )
            )
        },
        confirmButton = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(onClick = onConfirm) { Text(stringResource(R.string.common_yes)) }
                OutlinedButton(onClick = onDismiss) { Text(stringResource(R.string.common_back)) }
            }
        }
    )
}
