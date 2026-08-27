package com.terra.kensyuu.data.db.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

enum class InputSource { TAP, VOICE }

/**
 * 1回のタップ（または音声認識1件）を表す明細行。取消は物理削除せず
 * [cancelled] フラグを立てるだけに留める。これにより入力履歴に取消済み項目が
 * 薄いグレー＋取り消し線として残り続け、「何を取り消したか分からなくなる」という
 * 競合アプリの欠陥を解消する。[sequence] は伝票内での入力順（直前取消の判定に使用）。
 */
@Entity(
    tableName = "slip_lines",
    foreignKeys = [
        ForeignKey(
            entity = SlipEntity::class,
            parentColumns = ["id"],
            childColumns = ["slipId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("slipId"), Index("slipId", "diameterCm"), Index("slipId", "sequence")]
)
data class SlipLineEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val slipId: Long,
    val sequence: Int,
    val diameterCm: Int,
    val timestamp: Long,
    val cancelled: Boolean = false,
    val source: InputSource
)
