package com.terra.kensyuu.ui.menu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terra.kensyuu.data.db.entity.CompanyEntity
import com.terra.kensyuu.data.repository.TerraRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class CompanyViewModel(private val repository: TerraRepository) : ViewModel() {
    val companies: StateFlow<List<CompanyEntity>> = repository.observeCompanies()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun add(name: String) = viewModelScope.launch { repository.addCompany(name) }
    fun delete(company: CompanyEntity) = viewModelScope.launch { repository.deleteCompany(company) }
}
