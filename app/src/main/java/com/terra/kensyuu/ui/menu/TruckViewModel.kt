package com.terra.kensyuu.ui.menu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terra.kensyuu.data.db.entity.TruckEntity
import com.terra.kensyuu.data.repository.TerraRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TruckViewModel(private val repository: TerraRepository) : ViewModel() {
    val trucks: StateFlow<List<TruckEntity>> = repository.observeTrucks()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun add(number: String) = viewModelScope.launch { repository.addTruck(number) }
    fun delete(truck: TruckEntity) = viewModelScope.launch { repository.deleteTruck(truck) }
}
