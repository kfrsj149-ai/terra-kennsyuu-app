package com.terra.kensyuu.ui.measurement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terra.kensyuu.data.db.entity.InputSource
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.db.entity.SlipLineEntity
import com.terra.kensyuu.data.repository.SlipTotals
import com.terra.kensyuu.data.repository.TerraRepository
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class MeasurementUiState(
    val slip: SlipEntity? = null,
    val lines: List<SlipLineEntity> = emptyList(),
    val totals: SlipTotals = SlipTotals(0, java.math.BigDecimal.ZERO.setScale(4), emptyMap()),
    val outputMemo: String = "",
    val showOutputConfirmDialog: Boolean = false,
    val isListening: Boolean = false
) {
    val diameterRange: IntRange
        get() = (slip?.minDiameterCm ?: 0)..(slip?.maxDiameterCm ?: 0)
}

/** 一度限りのUIイベント（タップ即時フィードバック、CSV共有トリガー等）。 */
sealed interface MeasurementEvent {
    data class DiameterAccepted(val diameterCm: Int) : MeasurementEvent
    data class DiameterOutOfRange(val diameterCm: Int) : MeasurementEvent
    data class LongPressUndone(val diameterCm: Int) : MeasurementEvent
    data class ExportReady(val slip: SlipEntity, val totals: SlipTotals) : MeasurementEvent
    data object NoDataToExport : MeasurementEvent
}

class MeasurementViewModel(
    private val repository: TerraRepository,
    private val slipId: Long
) : ViewModel() {

    private val slipFlow = repository.observeSlip(slipId)
    private val linesFlow = repository.observeLines(slipId)

    private val _outputMemo = MutableStateFlow("")
    private val _showOutputConfirmDialog = MutableStateFlow(false)
    private val _isListening = MutableStateFlow(false)

    private val _events = MutableSharedFlow<MeasurementEvent>(extraBufferCapacity = 8)
    val events = _events.asSharedFlow()

    val uiState: StateFlow<MeasurementUiState> = combine(
        slipFlow, linesFlow, _outputMemo, _showOutputConfirmDialog, _isListening
    ) { slip, lines, memo, showDialog, listening ->
        val totals = slip?.let { repository.computeTotals(lines, it.lengthCm) }
            ?: SlipTotals(0, java.math.BigDecimal.ZERO.setScale(4), emptyMap())
        MeasurementUiState(
            slip = slip,
            lines = lines,
            totals = totals,
            outputMemo = memo,
            showOutputConfirmDialog = showDialog,
            isListening = listening
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MeasurementUiState())

    fun onDiameterTap(diameterCm: Int) {
        val slip = uiState.value.slip ?: return
        if (diameterCm !in slip.minDiameterCm..slip.maxDiameterCm) return
        viewModelScope.launch {
            repository.recordInput(slipId, diameterCm, InputSource.TAP)
        }
    }

    fun onDiameterLongPress(diameterCm: Int) {
        viewModelScope.launch {
            if (repository.undoForDiameter(slipId, diameterCm)) {
                _events.tryEmit(MeasurementEvent.LongPressUndone(diameterCm))
            }
        }
    }

    fun onUndoLast() {
        viewModelScope.launch { repository.undoLast(slipId) }
    }

    /** 音声認識結果を受け取る。範囲外の径級は登録せずイベントで通知する。 */
    fun onVoiceDiameterRecognized(diameterCm: Int) {
        val slip = uiState.value.slip ?: return
        if (diameterCm !in slip.minDiameterCm..slip.maxDiameterCm) {
            _events.tryEmit(MeasurementEvent.DiameterOutOfRange(diameterCm))
            return
        }
        viewModelScope.launch {
            repository.recordInput(slipId, diameterCm, InputSource.VOICE)
            _events.tryEmit(MeasurementEvent.DiameterAccepted(diameterCm))
        }
    }

    fun setListening(listening: Boolean) {
        _isListening.value = listening
    }

    fun onExportClicked() {
        val state = uiState.value
        if (state.totals.totalCount <= 0) {
            _events.tryEmit(MeasurementEvent.NoDataToExport)
            return
        }
        _showOutputConfirmDialog.value = true
    }

    fun onOutputMemoChange(value: String) {
        _outputMemo.value = value
    }

    fun dismissOutputConfirmDialog() {
        _showOutputConfirmDialog.value = false
    }

    /** 出力確認ダイアログ「はい」: 伝票を確定させ、CSV生成イベントを発火する。 */
    fun confirmExport() {
        val state = uiState.value
        val slip = state.slip ?: return
        viewModelScope.launch {
            repository.finalizeSlip(slipId, state.outputMemo)
            val finalized = repository.getSlip(slipId) ?: slip
            _showOutputConfirmDialog.value = false
            _events.tryEmit(MeasurementEvent.ExportReady(finalized, state.totals))
        }
    }
}
