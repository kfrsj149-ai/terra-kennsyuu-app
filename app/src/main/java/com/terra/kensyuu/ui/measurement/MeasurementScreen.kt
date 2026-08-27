package com.terra.kensyuu.ui.measurement

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.terra.kensyuu.R
import com.terra.kensyuu.data.export.CsvExporter
import com.terra.kensyuu.data.export.ShareIntentHelper
import com.terra.kensyuu.data.settings.AppLanguage
import com.terra.kensyuu.data.settings.AppSettings
import com.terra.kensyuu.data.settings.ButtonSide
import com.terra.kensyuu.ui.terraApplication
import com.terra.kensyuu.ui.theme.TerraExtraColors
import com.terra.kensyuu.util.KeepScreenOnAndBright
import com.terra.kensyuu.util.rememberTapFeedback
import com.terra.kensyuu.voice.rememberVoiceInputState

@Composable
fun MeasurementScreen(
    slipId: Long,
    onExported: () -> Unit
) {
    val app = terraApplication()
    val viewModel: MeasurementViewModel = viewModel(
        factory = viewModelFactory { initializer { MeasurementViewModel(app.repository, slipId) } }
    )
    val state by viewModel.uiState.collectAsState()
    val settings by app.settingsRepository.settings.collectAsState(initial = AppSettings.DEFAULT)
    val context = LocalContext.current
    val systemLocaleTag = LocalConfiguration.current.locales[0].toLanguageTag()
    val language = AppLanguage.resolveEffective(settings.languageTagOverride, systemLocaleTag)
    val tapFeedback = rememberTapFeedback()

    KeepScreenOnAndBright()

    val diameters = remember(state.slip) {
        val slip = state.slip
        if (slip == null) emptyList() else (slip.minDiameterCm..slip.maxDiameterCm step 2).toList()
    }

    val voice = rememberVoiceInputState(
        languageTag = language.tag,
        allowedDiameters = diameters,
        onDiameterRecognized = { d -> viewModel.onVoiceDiameterRecognized(d) }
    )

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is MeasurementEvent.DiameterOutOfRange -> Toast.makeText(
                    context,
                    context.getString(R.string.voice_out_of_range, event.diameterCm),
                    Toast.LENGTH_SHORT
                ).show()

                is MeasurementEvent.NoDataToExport -> Toast.makeText(
                    context,
                    context.getString(R.string.output_no_data_toast),
                    Toast.LENGTH_SHORT
                ).show()

                is MeasurementEvent.ExportReady -> {
                    val file = CsvExporter.buildCsv(context, language, event.slip, event.totals)
                    ShareIntentHelper.shareCsv(context, file)
                    onExported()
                }

                is MeasurementEvent.DiameterAccepted -> Unit

                is MeasurementEvent.LongPressUndone -> Toast.makeText(
                    context,
                    context.getString(R.string.measure_long_press_cancel_toast, event.diameterCm),
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    val slip = state.slip
    Scaffold { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            Column(modifier = Modifier.fillMaxSize()) {
                if (slip != null) {
                    MeasurementDashboard(
                        slip = slip,
                        totals = state.totals,
                        lines = state.lines,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                DiameterGrid(
                    diameters = diameters,
                    subtotals = state.totals.perDiameter,
                    onTap = { d ->
                        tapFeedback.onTap()
                        viewModel.onDiameterTap(d)
                    },
                    onLongPressUndo = { d ->
                        tapFeedback.onUndo()
                        viewModel.onDiameterLongPress(d)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 12.dp)
                )
            }

            // 直前取消は常に画面下中央固定（片手持ちの左右どちらでも届く位置）。
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                OutlinedButton(onClick = {
                    tapFeedback.onUndo()
                    viewModel.onUndoLast()
                }) {
                    Text(stringResource(R.string.measure_undo_last_button))
                }
                Text(
                    stringResource(R.string.measure_undo_last_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            val alignment = if (settings.buttonSide == ButtonSide.LEFT) {
                Alignment.BottomStart
            } else {
                Alignment.BottomEnd
            }
            Column(
                modifier = Modifier
                    .align(alignment)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                FloatingActionButton(
                    onClick = voice.toggle,
                    containerColor = if (voice.isListening) {
                        TerraExtraColors.buttonVoiceActive
                    } else {
                        TerraExtraColors.buttonVoice
                    }
                ) {
                    if (voice.isListening) {
                        Icon(
                            Icons.Filled.Mic,
                            contentDescription = stringResource(R.string.measure_voice_button_cd)
                        )
                    } else {
                        Icon(
                            Icons.Filled.MicOff,
                            contentDescription = stringResource(R.string.measure_voice_button_cd)
                        )
                    }
                }
                FloatingActionButton(
                    onClick = viewModel::onExportClicked,
                    containerColor = TerraExtraColors.buttonExport
                ) {
                    Icon(
                        Icons.Filled.Upload,
                        contentDescription = stringResource(R.string.measure_export_button)
                    )
                }
            }
        }
    }

    if (state.showOutputConfirmDialog && slip != null) {
        OutputConfirmDialog(
            slip = slip,
            totals = state.totals,
            memo = state.outputMemo,
            onMemoChange = viewModel::onOutputMemoChange,
            onConfirm = viewModel::confirmExport,
            onDismiss = viewModel::dismissOutputConfirmDialog
        )
    }
}
