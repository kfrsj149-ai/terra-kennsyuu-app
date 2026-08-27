package com.terra.kensyuu.data.db.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import com.terra.kensyuu.data.db.entity.CompanyEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CompanyDao {
    @Query("SELECT * FROM companies ORDER BY name ASC")
    fun observeAll(): Flow<List<CompanyEntity>>

    @Insert
    suspend fun insert(company: CompanyEntity): Long

    @Delete
    suspend fun delete(company: CompanyEntity)
}
