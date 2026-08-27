package com.terra.kensyuu

import android.app.Application
import com.terra.kensyuu.data.db.AppDatabase
import com.terra.kensyuu.data.repository.TerraRepository
import com.terra.kensyuu.data.settings.AppSettingsRepository

/**
 * DI用のシンプルな手動コンテナ。アプリ全体を通してRoom DBは1インスタンスのみ生成する。
 */
class TerraApplication : Application() {

    private val database: AppDatabase by lazy { AppDatabase.getInstance(this) }

    val repository: TerraRepository by lazy {
        TerraRepository(
            companyDao = database.companyDao(),
            truckDao = database.truckDao(),
            presetDao = database.presetDao(),
            slipDao = database.slipDao(),
            slipLineDao = database.slipLineDao()
        )
    }

    val settingsRepository: AppSettingsRepository by lazy { AppSettingsRepository(this) }
}
