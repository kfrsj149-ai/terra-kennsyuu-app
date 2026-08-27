package com.terra.kensyuu.data.backup

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object BackupScheduler {
    private const val UNIQUE_WORK_NAME = "terra_drive_backup"

    private val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.UNMETERED) // Wi-Fi接続時のみ
        .build()

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<DriveBackupWorker>(1, TimeUnit.DAYS)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
    }

    fun runNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<DriveBackupWorker>()
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueue(request)
    }
}
