package com.terra.kensyuu.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** 事前登録されたトラック車番。 */
@Entity(tableName = "trucks")
data class TruckEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val number: String,
    val createdAt: Long
)
