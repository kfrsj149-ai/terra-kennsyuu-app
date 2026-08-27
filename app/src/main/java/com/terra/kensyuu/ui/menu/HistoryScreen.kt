package com.terra.kensyuu.ui.menu

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.terra.kensyuu.R
import com.terra.kensyuu.ui.terraApplication
import com.terra.kensyuu.util.LengthFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(onBack: () -> Unit, onOpenSlip: (Long) -> Unit) {
    val app = terraApplication()
    val viewModel: HistoryViewModel = viewModel(
        factory = viewModelFactory { initializer { HistoryViewModel(app.repository) } }
    )
    val history by viewModel.history.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.history_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        if (history.isEmpty()) {
            Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                Text(stringResource(R.string.history_empty), style = MaterialTheme.typography.bodyMedium)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(history, key = { it.id }) { slip ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenSlip(slip.id) }
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                "${slip.slipDate}　No.${slip.slipNumber}",
                                style = MaterialTheme.typography.labelLarge
                            )
                            Text(
                                "${slip.species}　${LengthFormat.cmToDisplayString(slip.lengthCm)}m　" +
                                    "${slip.minDiameterCm}-${slip.maxDiameterCm}cm",
                                style = MaterialTheme.typography.bodyLarge
                            )
                        }
                    }
                }
            }
        }
    }
}
