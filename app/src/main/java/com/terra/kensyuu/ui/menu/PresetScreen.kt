package com.terra.kensyuu.ui.menu

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.terra.kensyuu.R
import com.terra.kensyuu.ui.components.DiameterRangeStepperRow
import com.terra.kensyuu.ui.components.TerraLargeButton
import com.terra.kensyuu.ui.setup.DIAMETER_MAX_CM
import com.terra.kensyuu.ui.setup.DIAMETER_MIN_CM
import com.terra.kensyuu.ui.setup.DIAMETER_STEP_CM
import com.terra.kensyuu.ui.terraApplication
import com.terra.kensyuu.util.LengthFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PresetScreen(onBack: () -> Unit) {
    val app = terraApplication()
    val viewModel: PresetViewModel = viewModel(
        factory = viewModelFactory { initializer { PresetViewModel(app.repository) } }
    )
    val presets by viewModel.presets.collectAsState()

    var label by remember { mutableStateOf("") }
    var species by remember { mutableStateOf("") }
    var lengthInput by remember { mutableStateOf("") }
    var minDiameter by remember { mutableIntStateOf(18) }
    var maxDiameter by remember { mutableIntStateOf(28) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.preset_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text(stringResource(R.string.preset_name_hint)) },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = species,
                    onValueChange = { species = it },
                    label = { Text(stringResource(R.string.preset_species_hint)) },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = lengthInput,
                    onValueChange = { input ->
                        lengthInput = input.filter { it.isDigit() || it == '.' }
                    },
                    label = { Text(stringResource(R.string.preset_length_hint)) },
                    modifier = Modifier.fillMaxWidth()
                )
                DiameterRangeStepperRow(
                    minValueCm = minDiameter,
                    maxValueCm = maxDiameter,
                    onMinIncrement = {
                        minDiameter = (minDiameter + DIAMETER_STEP_CM).coerceAtMost(DIAMETER_MAX_CM)
                        maxDiameter = maxOf(minDiameter, maxDiameter)
                    },
                    onMinDecrement = { minDiameter = (minDiameter - DIAMETER_STEP_CM).coerceAtLeast(DIAMETER_MIN_CM) },
                    onMaxIncrement = { maxDiameter = (maxDiameter + DIAMETER_STEP_CM).coerceAtMost(DIAMETER_MAX_CM) },
                    onMaxDecrement = {
                        maxDiameter = (maxDiameter - DIAMETER_STEP_CM).coerceAtLeast(DIAMETER_MIN_CM)
                        minDiameter = minOf(minDiameter, maxDiameter)
                    },
                    isError = false
                )
                TerraLargeButton(
                    text = stringResource(R.string.preset_add),
                    onClick = {
                        val lengthCm = LengthFormat.parseToCm(lengthInput)
                        if (species.isNotBlank() && lengthCm != null) {
                            viewModel.add(label.ifBlank { null }, species, lengthCm, minDiameter, maxDiameter)
                            label = ""
                            species = ""
                            lengthInput = ""
                        }
                    }
                )
            }

            if (presets.isEmpty()) {
                Text(stringResource(R.string.preset_empty), style = MaterialTheme.typography.bodyMedium)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(presets) { preset ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                val display = preset.label?.ifBlank { null }
                                    ?: "${preset.species} ${LengthFormat.cmToDisplayString(preset.lengthCm)}m " +
                                        "${preset.minDiameterCm}-${preset.maxDiameterCm}cm"
                                Text(display, style = MaterialTheme.typography.bodyLarge)
                                IconButton(onClick = { viewModel.delete(preset) }) {
                                    Icon(
                                        Icons.Filled.Delete,
                                        contentDescription = stringResource(R.string.common_delete)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
