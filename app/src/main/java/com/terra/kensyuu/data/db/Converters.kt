package com.terra.kensyuu.data.db

import androidx.room.TypeConverter
import com.terra.kensyuu.data.db.entity.InputSource

class Converters {
    @TypeConverter
    fun fromInputSource(value: InputSource): String = value.name

    @TypeConverter
    fun toInputSource(value: String): InputSource = InputSource.valueOf(value)
}
