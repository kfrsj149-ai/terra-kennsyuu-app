package com.terra.kensyuu.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import com.terra.kensyuu.data.db.entity.SlipEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SlipDao {
    @Insert
    suspend fun insert(slip: SlipEntity): Long

    @Update
    suspend fun update(slip: SlipEntity)

    @Query("SELECT * FROM slips WHERE id = :slipId")
    suspend fun getById(slipId: Long): SlipEntity?

    @Query("SELECT * FROM slips WHERE id = :slipId")
    fun observeById(slipId: Long): Flow<SlipEntity?>

    /** 未出力（作業中）の伝票。アプリ再起動時の自動復帰に使う。高々1件を想定。 */
    @Query("SELECT * FROM slips WHERE exportedAt IS NULL ORDER BY createdAt DESC LIMIT 1")
    suspend fun getActiveDraft(): SlipEntity?

    /** 伝票番号の日次リセット用に、同日の最大伝票番号を調べる。 */
    @Query("SELECT * FROM slips WHERE slipDate = :slipDate ORDER BY createdAt DESC LIMIT 1")
    suspend fun getLatestForDate(slipDate: String): SlipEntity?

    @Query("SELECT * FROM slips WHERE exportedAt IS NOT NULL ORDER BY createdAt DESC")
    fun observeHistory(): Flow<List<SlipEntity>>
}
