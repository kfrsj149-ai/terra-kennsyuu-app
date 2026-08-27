package com.terra.kensyuu.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import com.terra.kensyuu.data.db.entity.SlipLineEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SlipLineDao {
    @Insert
    suspend fun insert(line: SlipLineEntity): Long

    @Update
    suspend fun update(line: SlipLineEntity)

    @Query("SELECT * FROM slip_lines WHERE slipId = :slipId ORDER BY sequence ASC")
    fun observeForSlip(slipId: Long): Flow<List<SlipLineEntity>>

    @Query("SELECT * FROM slip_lines WHERE slipId = :slipId ORDER BY sequence ASC")
    suspend fun getForSlip(slipId: Long): List<SlipLineEntity>

    @Query("SELECT COALESCE(MAX(sequence), -1) FROM slip_lines WHERE slipId = :slipId")
    suspend fun getMaxSequence(slipId: Long): Int

    @Query(
        "SELECT * FROM slip_lines WHERE slipId = :slipId AND cancelled = 0 " +
            "ORDER BY sequence DESC LIMIT 1"
    )
    suspend fun getLatestActive(slipId: Long): SlipLineEntity?

    @Query(
        "SELECT * FROM slip_lines WHERE slipId = :slipId AND diameterCm = :diameterCm " +
            "AND cancelled = 0 ORDER BY sequence DESC LIMIT 1"
    )
    suspend fun getLatestActiveForDiameter(slipId: Long, diameterCm: Int): SlipLineEntity?
}
