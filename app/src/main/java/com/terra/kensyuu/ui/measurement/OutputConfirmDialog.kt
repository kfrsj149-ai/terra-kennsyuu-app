package com.terra.kensyuu.ui.measurement

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.repository.SlipTotals
import com.terra.kensyuu.util.LengthFormat
import com.terra.kensyuu.util.VolumeFormat

/**
 * 出力ボタンとこのダイアログの表示タイミングを分離し、連続タップによる誤出力を
 * 防止する（データ出力ボタン押下 → このダイアログでもう一段確認 → 共有）。
 * 「はい」を左側、「戻る」を右側に配置。
 */
@Composable
fun OutputConfirmDialog(
    slip: SlipEntity,
    totals: SlipTotals,
    memo: String,
    onMemoChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.output_confirm_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.output_confirm_species, slip.species))
                Text(
                    stringResource(
                        R.string.output_confirm_length,
                        LengthFormat.cmToDisplayString(slip.lengthCm)
                    )
                )
                Text(stringResource(R.string.output_confirm_count, totals.totalCount))
                Text(stringResource(R.string.output_confirm_volume, VolumeFormat.format(totals.totalVolume)))
                OutlinedTextField(
                    value = memo,
                    onValueChange = onMemoChange,
                    label = { Text(stringResource(R.string.output_confirm_memo_label)) },
                    placeholder = { Text(stringResource(R.string.output_confirm_memo_hint)) },
                    modifier = Modifier.fillMaxWidth()
                )
                Text(stringResource(R.string.output_confirm_message))
            }
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
