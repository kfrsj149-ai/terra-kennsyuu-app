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
fun CompanyScreen(onBack: () -> Unit) {
    val app = terraApplication()
    val viewModel: CompanyViewModel = viewModel(
        factory = viewModelFactory { initializer { CompanyViewModel(app.repository) } }
    )
    val companies by viewModel.companies.collectAsState()

    NameListScreen(
        titleRes = R.string.company_title,
        hintRes = R.string.company_name_hint,
        addLabelRes = R.string.company_add_button,
        emptyLabelRes = R.string.company_empty,
        items = companies,
        nameOf = { it.name },
        onAdd = viewModel::add,
        onDelete = viewModel::delete,
        onBack = onBack
    )
}
