package com.terra.kensyuu.ui.menu

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.terra.kensyuu.R
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.export.CsvExporter
import com.terra.kensyuu.data.export.ShareIntentHelper
import com.terra.kensyuu.data.repository.SlipTotals
import com.terra.kensyuu.data.settings.AppLanguage
import com.terra.kensyuu.data.settings.AppSettings
import com.terra.kensyuu.ui.components.TerraLargeButton
import com.terra.kensyuu.ui.terraApplication
import com.terra.kensyuu.util.LengthFormat
import com.terra.kensyuu.util.VolumeFormat
import androidx.compose.runtime.collectAsState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryDetailScreen(slipId: Long, onBack: () -> Unit) {
    val app = terraApplication()
    val context = LocalContext.current
    val settings by app.settingsRepository.settings.collectAsState(initial = AppSettings.DEFAULT)
    val systemLocaleTag = LocalConfiguration.current.locales[0].toLanguageTag()
    val language = AppLanguage.resolveEffective(settings.languageTagOverride, systemLocaleTag)

    var slip by remember { mutableStateOf<SlipEntity?>(null) }
    var totals by remember { mutableStateOf<SlipTotals?>(null) }

    LaunchedEffect(slipId) {
        val loadedSlip = app.repository.getSlip(slipId) ?: return@LaunchedEffect
        val lines = app.repository.getLines(slipId)
        slip = loadedSlip
        totals = app.repository.computeTotals(lines, loadedSlip.lengthCm)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.history_reopen)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        val currentSlip = slip
        val currentTotals = totals
        if (currentSlip == null || currentTotals == null) {
            Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                Text(stringResource(R.string.history_empty))
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                "${currentSlip.slipDate}　No.${currentSlip.slipNumber}",
                style = MaterialTheme.typography.titleLarge
            )
            Text(
                "${currentSlip.species}　${LengthFormat.cmToDisplayString(currentSlip.lengthCm)}m　" +
                    "${currentSlip.minDiameterCm}-${currentSlip.maxDiameterCm}cm",
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                stringResource(R.string.output_confirm_count, currentTotals.totalCount),
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                stringResource(R.string.output_confirm_volume, VolumeFormat.format(currentTotals.totalVolume)),
                style = MaterialTheme.typography.bodyLarge
            )
            HorizontalDivider()
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(currentTotals.perDiameter.values.filter { it.activeCount > 0 }.sortedBy { it.diameterCm }) { d ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("${d.diameterCm}cm")
                        Text("${d.activeCount}${stringResource(R.string.measure_unit_count)}")
                        Text("${VolumeFormat.format(d.subtotalVolume)}${stringResource(R.string.measure_unit_volume)}")
                    }
                }
            }
            TerraLargeButton(
                text = stringResource(R.string.history_export_again),
                onClick = {
                    val file = CsvExporter.buildCsv(context, language, currentSlip, currentTotals)
                    ShareIntentHelper.shareCsv(context, file)
                }
            )
        }
    }
}
