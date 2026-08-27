package com.terra.kensyuu.ui.menu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terra.kensyuu.data.db.entity.PresetEntity
import com.terra.kensyuu.data.repository.TerraRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class PresetViewModel(private val repository: TerraRepository) : ViewModel() {
    val presets: StateFlow<List<PresetEntity>> = repository.observePresets()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun add(label: String?, species: String, lengthCm: Int, minDiameterCm: Int, maxDiameterCm: Int) {
        viewModelScope.launch {
            repository.addPreset(label, species, lengthCm, minDiameterCm, maxDiameterCm)
        }
    }

    fun delete(preset: PresetEntity) = viewModelScope.launch { repository.deletePreset(preset) }
}
