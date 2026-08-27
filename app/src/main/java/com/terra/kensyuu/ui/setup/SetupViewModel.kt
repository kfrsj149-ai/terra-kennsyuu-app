package com.terra.kensyuu.ui.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terra.kensyuu.data.db.entity.CompanyEntity
import com.terra.kensyuu.data.db.entity.PresetEntity
import com.terra.kensyuu.data.db.entity.TruckEntity
import com.terra.kensyuu.data.repository.TerraRepository
import com.terra.kensyuu.util.LengthFormat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

const val DIAMETER_STEP_CM = 2
const val DIAMETER_MIN_CM = 6
const val DIAMETER_MAX_CM = 120

data class SetupUiState(
    val species: String = "",
    val lengthInput: String = "",
    val minDiameterCm: Int = 18,
    val maxDiameterCm: Int = 28,
    val truckNumber: String? = null,
    val siteName: String = "",
    val destination: String = "",
    val companyName: String? = null,
    val memo: String = "",
    val companies: List<CompanyEntity> = emptyList(),
    val trucks: List<TruckEntity> = emptyList(),
    val presets: List<PresetEntity> = emptyList(),
    val speciesError: Boolean = false,
    val lengthError: Boolean = false,
    val diameterRangeError: Boolean = false,
    val showConfirmDialog: Boolean = false
) {
    val lengthCm: Int? get() = LengthFormat.parseToCm(lengthInput)
}

class SetupViewModel(private val repository: TerraRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupUiState())
    val uiState: StateFlow<SetupUiState> = _uiState.asStateFlow()

    private val _navigateToSlipId = MutableStateFlow<Long?>(null)
    val navigateToSlipId: StateFlow<Long?> = _navigateToSlipId.asStateFlow()

    init {
        viewModelScope.launch {
            repository.observeCompanies().collect { list ->
                _uiState.value = _uiState.value.copy(companies = list)
            }
        }
        viewModelScope.launch {
            repository.observeTrucks().collect { list ->
                _uiState.value = _uiState.value.copy(trucks = list)
            }
        }
        viewModelScope.launch {
            repository.observePresets().collect { list ->
                _uiState.value = _uiState.value.copy(presets = list)
            }
        }
    }

    fun onSpeciesChange(value: String) {
        _uiState.value = _uiState.value.copy(species = value, speciesError = false)
    }

    fun onLengthInputChange(value: String) {
        // 数字と小数点のみ許容し、小数点以下2桁までに制限する。
        val filtered = value.filter { it.isDigit() || it == '.' }
        val parts = filtered.split(".")
        val normalized = if (parts.size > 2) {
            parts[0] + "." + parts.drop(1).joinToString("")
        } else filtered
        val capped = if (normalized.contains(".")) {
            val (intPart, fracPart) = normalized.split(".", limit = 2)
            intPart + "." + fracPart.take(2)
        } else normalized
        _uiState.value = _uiState.value.copy(lengthInput = capped, lengthError = false)
    }

    fun onMinDiameterIncrement() {
        val s = _uiState.value
        val next = (s.minDiameterCm + DIAMETER_STEP_CM).coerceAtMost(DIAMETER_MAX_CM)
        _uiState.value = s.copy(
            minDiameterCm = next,
            maxDiameterCm = maxOf(next, s.maxDiameterCm),
            diameterRangeError = false
        )
    }

    fun onMinDiameterDecrement() {
        val s = _uiState.value
        val next = (s.minDiameterCm - DIAMETER_STEP_CM).coerceAtLeast(DIAMETER_MIN_CM)
        _uiState.value = s.copy(minDiameterCm = next, diameterRangeError = false)
    }

    fun onMaxDiameterIncrement() {
        val s = _uiState.value
        val next = (s.maxDiameterCm + DIAMETER_STEP_CM).coerceAtMost(DIAMETER_MAX_CM)
        _uiState.value = s.copy(maxDiameterCm = next, diameterRangeError = false)
    }

    fun onMaxDiameterDecrement() {
        val s = _uiState.value
        val next = (s.maxDiameterCm - DIAMETER_STEP_CM).coerceAtLeast(DIAMETER_MIN_CM)
        _uiState.value = s.copy(
            maxDiameterCm = next,
            minDiameterCm = minOf(next, s.minDiameterCm),
            diameterRangeError = false
        )
    }

    fun onTruckSelected(number: String?) {
        _uiState.value = _uiState.value.copy(truckNumber = number)
    }

    fun onSiteNameChange(value: String) {
        _uiState.value = _uiState.value.copy(siteName = value)
    }

    fun onDestinationChange(value: String) {
        _uiState.value = _uiState.value.copy(destination = value)
    }

    fun onCompanySelected(name: String?) {
        _uiState.value = _uiState.value.copy(companyName = name)
    }

    fun onMemoChange(value: String) {
        _uiState.value = _uiState.value.copy(memo = value)
    }

    fun applyPreset(preset: PresetEntity) {
        _uiState.value = _uiState.value.copy(
            species = preset.species,
            lengthInput = LengthFormat.cmToDisplayString(preset.lengthCm),
            minDiameterCm = preset.minDiameterCm,
            maxDiameterCm = preset.maxDiameterCm,
            speciesError = false,
            lengthError = false,
            diameterRangeError = false
        )
    }

    /** 計測開始ボタン: バリデーションを通れば確認ダイアログを開く。 */
    fun onStartMeasurementClicked() {
        val s = _uiState.value
        val speciesError = s.species.isBlank()
        val lengthError = s.lengthCm == null
        val diameterRangeError = s.minDiameterCm > s.maxDiameterCm
        if (speciesError || lengthError || diameterRangeError) {
            _uiState.value = s.copy(
                speciesError = speciesError,
                lengthError = lengthError,
                diameterRangeError = diameterRangeError
            )
            return
        }
        _uiState.value = s.copy(showConfirmDialog = true)
    }

    fun dismissConfirmDialog() {
        _uiState.value = _uiState.value.copy(showConfirmDialog = false)
    }

    /** 開始確認ダイアログ「はい」: 伝票を作成して計測画面へ遷移する。 */
    fun confirmStartMeasurement() {
        val s = _uiState.value
        val lengthCm = s.lengthCm ?: return
        viewModelScope.launch {
            val slipId = repository.startNewSlip(
                species = s.species.trim(),
                lengthCm = lengthCm,
                minDiameterCm = s.minDiameterCm,
                maxDiameterCm = s.maxDiameterCm,
                truckNumber = s.truckNumber,
                siteName = s.siteName.trim().ifBlank { null },
                destination = s.destination.trim().ifBlank { null },
                companyName = s.companyName,
                memoSetup = s.memo.trim().ifBlank { null }
            )
            _uiState.value = s.copy(showConfirmDialog = false)
            _navigateToSlipId.value = slipId
        }
    }

    fun onNavigationConsumed() {
        _navigateToSlipId.value = null
    }
}
