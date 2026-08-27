package com.terra.kensyuu.ui.navigation

object TerraDestinations {
    const val SETUP = "setup"
    const val MEASUREMENT = "measurement/{slipId}"
    const val COMPANIES = "menu/companies"
    const val TRUCKS = "menu/trucks"
    const val PRESETS = "menu/presets"
    const val LANGUAGE = "menu/language"
    const val BUTTON_SIDE = "menu/buttonSide"
    const val HISTORY = "menu/history"
    const val HISTORY_DETAIL = "menu/history/{slipId}"
    const val BACKUP = "menu/backup"

    fun measurement(slipId: Long) = "measurement/$slipId"
    fun historyDetail(slipId: Long) = "menu/history/$slipId"
}
