package com.terra.kensyuu.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.terra.kensyuu.R
import com.terra.kensyuu.data.db.entity.PresetEntity
import com.terra.kensyuu.ui.components.DiameterRangeStepperRow
import com.terra.kensyuu.ui.components.SelectorField
import com.terra.kensyuu.ui.components.TerraLargeButton
import com.terra.kensyuu.ui.terraApplication
import com.terra.kensyuu.util.KeepScreenOnAndBright

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(
    onMenuClick: () -> Unit,
    onMeasurementStarted: (Long) -> Unit
) {
    val app = terraApplication()
    val viewModel: SetupViewModel = viewModel(
        factory = viewModelFactory { initializer { SetupViewModel(app.repository) } }
    )
    val state by viewModel.uiState.collectAsState()
    val navigateToSlipId by viewModel.navigateToSlipId.collectAsState()

    KeepScreenOnAndBright()

    LaunchedEffect(navigateToSlipId) {
        navigateToSlipId?.let {
            onMeasurementStarted(it)
            viewModel.onNavigationConsumed()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.setup_title)) },
                navigationIcon = {
                    IconButton(onClick = onMenuClick) {
                        Icon(Icons.Filled.Menu, contentDescription = stringResource(R.string.menu_open_cd))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (state.presets.isNotEmpty()) {
                Text(
                    stringResource(R.string.setup_preset_shortcut_title),
                    style = MaterialTheme.typography.titleLarge
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.presets) { preset ->
                        PresetShortcutButton(preset) { viewModel.applyPreset(preset) }
                    }
                }
            }

            OutlinedTextField(
                value = state.species,
                onValueChange = viewModel::onSpeciesChange,
                label = { Text(stringResource(R.string.setup_species_label)) },
                placeholder = { Text(stringResource(R.string.setup_species_hint)) },
                isError = state.speciesError,
                supportingText = {
                    if (state.speciesError) Text(stringResource(R.string.setup_error_species_required))
                },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = state.lengthInput,
                onValueChange = viewModel::onLengthInputChange,
                label = { Text(stringResource(R.string.setup_length_label)) },
                placeholder = { Text(stringResource(R.string.setup_length_hint)) },
                suffix = { Text("m") },
                isError = state.lengthError,
                supportingText = {
                    if (state.lengthError) Text(stringResource(R.string.setup_error_length_invalid))
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth()
            )

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    stringResource(R.string.setup_diameter_range_label),
                    style = MaterialTheme.typography.titleLarge
                )
                DiameterRangeStepperRow(
                    minValueCm = state.minDiameterCm,
                    maxValueCm = state.maxDiameterCm,
                    onMinIncrement = viewModel::onMinDiameterIncrement,
                    onMinDecrement = viewModel::onMinDiameterDecrement,
                    onMaxIncrement = viewModel::onMaxDiameterIncrement,
                    onMaxDecrement = viewModel::onMaxDiameterDecrement,
                    isError = state.diameterRangeError
                )
                if (state.diameterRangeError) {
                    Text(
                        stringResource(R.string.setup_error_diameter_range_invalid),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            SelectorField(
                label = stringResource(R.string.setup_truck_label),
                selected = state.truckNumber,
                options = state.trucks.map { it.number },
                onSelect = viewModel::onTruckSelected
            )

            OutlinedTextField(
                value = state.siteName,
                onValueChange = viewModel::onSiteNameChange,
                label = { Text(stringResource(R.string.setup_site_label)) },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = state.destination,
                onValueChange = viewModel::onDestinationChange,
                label = { Text(stringResource(R.string.setup_destination_label)) },
                modifier = Modifier.fillMaxWidth()
            )

            SelectorField(
                label = stringResource(R.string.setup_company_label),
                selected = state.companyName,
                options = state.companies.map { it.name },
                onSelect = viewModel::onCompanySelected
            )

            OutlinedTextField(
                value = state.memo,
                onValueChange = viewModel::onMemoChange,
                label = { Text(stringResource(R.string.setup_memo_label)) },
                placeholder = { Text(stringResource(R.string.setup_memo_hint)) },
                modifier = Modifier.fillMaxWidth()
            )

            TerraLargeButton(
                text = stringResource(R.string.setup_start_button),
                onClick = viewModel::onStartMeasurementClicked
            )
        }
    }

    if (state.showConfirmDialog) {
        val lengthCm = state.lengthCm
        if (lengthCm != null) {
            StartConfirmDialog(
                species = state.species,
                lengthCm = lengthCm,
                minDiameterCm = state.minDiameterCm,
                maxDiameterCm = state.maxDiameterCm,
                onConfirm = viewModel::confirmStartMeasurement,
                onDismiss = viewModel::dismissConfirmDialog
            )
        }
    }
}

@Composable
private fun PresetShortcutButton(preset: PresetEntity, onClick: () -> Unit) {
    val label = preset.label?.ifBlank { null }
        ?: "${preset.species} ${preset.lengthCm / 100}.${(preset.lengthCm % 100).toString().padStart(2, '0')}m " +
            "${preset.minDiameterCm}-${preset.maxDiameterCm}cm"
    Card {
        OutlinedButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
            Text(label)
        }
    }
}
