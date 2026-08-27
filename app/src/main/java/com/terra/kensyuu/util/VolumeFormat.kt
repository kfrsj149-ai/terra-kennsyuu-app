package com.terra.kensyuu.util

import java.math.BigDecimal
import java.math.RoundingMode

/** 材積表示は常に小数第4位まで（切り捨て後の値をそのまま表示する）。 */
object VolumeFormat {
    fun format(volume: BigDecimal): String = volume.setScale(4, RoundingMode.DOWN).toPlainString()
}
