package com.terra.kensyuu.ui.menu

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.terra.kensyuu.R
import com.terra.kensyuu.ui.terraApplication

@Composable
fun TruckScreen(onBack: () -> Unit) {
    val app = terraApplication()
    val viewModel: TruckViewModel = viewModel(
        factory = viewModelFactory { initializer { TruckViewModel(app.repository) } }
    )
    val trucks by viewModel.trucks.collectAsState()

    NameListScreen(
        titleRes = R.string.truck_title,
        hintRes = R.string.truck_number_hint,
        addLabelRes = R.string.truck_add_button,
        emptyLabelRes = R.string.truck_empty,
        items = trucks,
        nameOf = { it.number },
        onAdd = viewModel::add,
        onDelete = viewModel::delete,
        onBack = onBack
    )
}
