package com.terra.kensyuu.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 事前登録された会社名。運送業者は複数の得意先を、素材生産業者は自社名のみを
 * 登録するといった運用を想定し、件数に制約は設けない。
 */
@Entity(tableName = "companies")
data class CompanyEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val name: String,
    val createdAt: Long
)
