package com.terra.kensyuu.data.repository

import com.terra.kensyuu.calc.JasVolumeCalculator
import com.terra.kensyuu.data.db.dao.CompanyDao
import com.terra.kensyuu.data.db.dao.PresetDao
import com.terra.kensyuu.data.db.dao.SlipDao
import com.terra.kensyuu.data.db.dao.SlipLineDao
import com.terra.kensyuu.data.db.dao.TruckDao
import com.terra.kensyuu.data.db.entity.CompanyEntity
import com.terra.kensyuu.data.db.entity.InputSource
import com.terra.kensyuu.data.db.entity.PresetEntity
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.db.entity.SlipLineEntity
import com.terra.kensyuu.data.db.entity.TruckEntity
import kotlinx.coroutines.flow.Flow
import java.math.BigDecimal
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class DiameterSubtotal(
    val diameterCm: Int,
    val activeCount: Int,
    val subtotalVolume: BigDecimal
)

data class SlipTotals(
    val totalCount: Int,
    val totalVolume: BigDecimal,
    val perDiameter: Map<Int, DiameterSubtotal>
)

/**
 * DAO群とJAS計算エンジンを束ね、画面が必要とするユースケース単位のAPIを提供する。
 * 全ての入力操作（タップ・音声どちらも）はDBへ即時反映され、取消は論理削除
 * （cancelledフラグ）のみで物理削除しない。
 */
class TerraRepository(
    private val companyDao: CompanyDao,
    private val truckDao: TruckDao,
    private val presetDao: PresetDao,
    private val slipDao: SlipDao,
    private val slipLineDao: SlipLineDao
) {
    private val slipDateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    // --- 事前登録: 会社名 / 車番 ---

    fun observeCompanies(): Flow<List<CompanyEntity>> = companyDao.observeAll()

    suspend fun addCompany(name: String) {
        if (name.isBlank()) return
        companyDao.insert(CompanyEntity(name = name.trim(), createdAt = System.currentTimeMillis()))
    }

    suspend fun deleteCompany(company: CompanyEntity) = companyDao.delete(company)

    fun observeTrucks(): Flow<List<TruckEntity>> = truckDao.observeAll()

    suspend fun addTruck(number: String) {
        if (number.isBlank()) return
        truckDao.insert(TruckEntity(number = number.trim(), createdAt = System.currentTimeMillis()))
    }

    suspend fun deleteTruck(truck: TruckEntity) = truckDao.delete(truck)

    // --- よく使う設定 ---

    fun observePresets(): Flow<List<PresetEntity>> = presetDao.observeAll()

    suspend fun addPreset(
        label: String?,
        species: String,
        lengthCm: Int,
        minDiameterCm: Int,
        maxDiameterCm: Int
    ) {
        presetDao.insert(
            PresetEntity(
                label = label?.trim()?.ifBlank { null },
                species = species.trim(),
                lengthCm = lengthCm,
                minDiameterCm = minDiameterCm,
                maxDiameterCm = maxDiameterCm,
                createdAt = System.currentTimeMillis()
            )
        )
    }

    suspend fun deletePreset(preset: PresetEntity) = presetDao.delete(preset)

    // --- 伝票（計測セッション） ---

    suspend fun getActiveDraftSlip(): SlipEntity? = slipDao.getActiveDraft()

    fun observeSlip(slipId: Long): Flow<SlipEntity?> = slipDao.observeById(slipId)

    suspend fun getSlip(slipId: Long): SlipEntity? = slipDao.getById(slipId)

    fun observeHistory(): Flow<List<SlipEntity>> = slipDao.observeHistory()

    suspend fun startNewSlip(
        species: String,
        lengthCm: Int,
        minDiameterCm: Int,
        maxDiameterCm: Int,
        truckNumber: String?,
        siteName: String?,
        destination: String?,
        companyName: String?,
        memoSetup: String?
    ): Long {
        val now = System.currentTimeMillis()
        val date = slipDateFormat.format(Date(now))
        val slipNumber = nextSlipNumber(date)
        val slip = SlipEntity(
            slipDate = date,
            slipNumber = slipNumber,
            species = species,
            lengthCm = lengthCm,
            minDiameterCm = minDiameterCm,
            maxDiameterCm = maxDiameterCm,
            truckNumber = truckNumber,
            siteName = siteName,
            destination = destination,
            companyName = companyName,
            memoSetup = memoSetup,
            memoOutput = null,
            createdAt = now,
            exportedAt = null
        )
        return slipDao.insert(slip)
    }

    private suspend fun nextSlipNumber(date: String): String {
        val latest = slipDao.getLatestForDate(date) ?: return "001"
        val nextValue = (latest.slipNumber.toIntOrNull() ?: 0) + 1
        return nextValue.toString().padStart(3, '0')
    }

    suspend fun updateSlipNumber(slipId: Long, newNumber: String) {
        val slip = slipDao.getById(slipId) ?: return
        slipDao.update(slip.copy(slipNumber = newNumber))
    }

    suspend fun finalizeSlip(slipId: Long, memoOutput: String?) {
        val slip = slipDao.getById(slipId) ?: return
        slipDao.update(
            slip.copy(memoOutput = memoOutput?.ifBlank { null }, exportedAt = System.currentTimeMillis())
        )
    }

    // --- 明細行（径級入力） ---

    fun observeLines(slipId: Long): Flow<List<SlipLineEntity>> = slipLineDao.observeForSlip(slipId)

    suspend fun getLines(slipId: Long): List<SlipLineEntity> = slipLineDao.getForSlip(slipId)

    suspend fun recordInput(slipId: Long, diameterCm: Int, source: InputSource): Long {
        val nextSequence = slipLineDao.getMaxSequence(slipId) + 1
        return slipLineDao.insert(
            SlipLineEntity(
                slipId = slipId,
                sequence = nextSequence,
                diameterCm = diameterCm,
                timestamp = System.currentTimeMillis(),
                cancelled = false,
                source = source
            )
        )
    }

    /** 直前取消: 伝票内で最新の有効な明細を1件取消にする。 */
    suspend fun undoLast(slipId: Long): Boolean {
        val target = slipLineDao.getLatestActive(slipId) ?: return false
        slipLineDao.update(target.copy(cancelled = true))
        return true
    }

    /** 長押し取消: 指定した径級のうち最新の有効な明細を1件取消にする。 */
    suspend fun undoForDiameter(slipId: Long, diameterCm: Int): Boolean {
        val target = slipLineDao.getLatestActiveForDiameter(slipId, diameterCm) ?: return false
        slipLineDao.update(target.copy(cancelled = true))
        return true
    }

    // --- 集計 ---

    fun computeTotals(lines: List<SlipLineEntity>, lengthCm: Int): SlipTotals {
        val lengthMeters = BigDecimal(lengthCm).divide(BigDecimal(100))
        val perDiameter = linkedMapOf<Int, MutableList<SlipLineEntity>>()
        for (line in lines) {
            perDiameter.getOrPut(line.diameterCm) { mutableListOf() }.add(line)
        }
        var totalCount = 0
        var totalVolume = BigDecimal.ZERO.setScale(4)
        val subtotals = linkedMapOf<Int, DiameterSubtotal>()
        for ((diameter, entries) in perDiameter) {
            val activeCount = entries.count { !it.cancelled }
            val subtotal = JasVolumeCalculator.calculateSubtotal(diameter, activeCount, lengthMeters)
            subtotals[diameter] = DiameterSubtotal(diameter, activeCount, subtotal)
            totalCount += activeCount
            totalVolume += subtotal
        }
        return SlipTotals(totalCount, totalVolume, subtotals)
    }
}
