package com.terra.kensyuu.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.terra.kensyuu.data.db.dao.CompanyDao
import com.terra.kensyuu.data.db.dao.PresetDao
import com.terra.kensyuu.data.db.dao.SlipDao
import com.terra.kensyuu.data.db.dao.SlipLineDao
import com.terra.kensyuu.data.db.dao.TruckDao
import com.terra.kensyuu.data.db.entity.CompanyEntity
import com.terra.kensyuu.data.db.entity.PresetEntity
import com.terra.kensyuu.data.db.entity.SlipEntity
import com.terra.kensyuu.data.db.entity.SlipLineEntity
import com.terra.kensyuu.data.db.entity.TruckEntity

@Database(
    entities = [
        CompanyEntity::class,
        TruckEntity::class,
        PresetEntity::class,
        SlipEntity::class,
        SlipLineEntity::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun companyDao(): CompanyDao
    abstract fun truckDao(): TruckDao
    abstract fun presetDao(): PresetDao
    abstract fun slipDao(): SlipDao
    abstract fun slipLineDao(): SlipLineDao

    companion object {
        private const val DB_NAME = "terra.db"

        @Volatile
        private var instance: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    DB_NAME
                ).build().also { instance = it }
            }
    }
}
