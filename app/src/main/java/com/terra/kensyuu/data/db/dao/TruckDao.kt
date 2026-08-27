package com.terra.kensyuu.data.db.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import com.terra.kensyuu.data.db.entity.TruckEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TruckDao {
    @Query("SELECT * FROM trucks ORDER BY number ASC")
    fun observeAll(): Flow<List<TruckEntity>>

    @Insert
    suspend fun insert(truck: TruckEntity): Long

    @Delete
    suspend fun delete(truck: TruckEntity)
}
