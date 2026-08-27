package com.terra.kensyuu.ui.menu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.repository.TerraRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class HistoryViewModel(repository: TerraRepository) : ViewModel() {
    val history: StateFlow<List<SlipEntity>> = repository.observeHistory()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
}
