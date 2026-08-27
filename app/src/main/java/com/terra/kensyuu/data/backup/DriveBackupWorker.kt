package com.terra.kensyuu.data.backup

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.terra.kensyuu.TerraApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * Wi-Fi接続時に1日1回、ローカルDBをGoogleドライブへ自動バックアップする。
 * サインインしていない・バックアップが無効化されている場合は何もせず成功扱いで
 * 終了する（オフライン思想を壊さない裏処理として振る舞う）。
 */
class DriveBackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val app = applicationContext as TerraApplication
        val current = app.settingsRepository.settings.first()
        if (!current.backupEnabled) return@withContext Result.success()

        val account = GoogleSignInHelper.lastSignedInAccount(applicationContext)
            ?.let { GoogleSignInHelper.toAndroidAccount(it) }
            ?: return@withContext Result.success()

        try {
            val dbFile = applicationContext.getDatabasePath("terra.db")
            if (dbFile.exists()) {
                DriveBackupUploader.uploadDatabaseBackup(applicationContext, account, dbFile)
                app.settingsRepository.setLastBackupAt(System.currentTimeMillis())
            }
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
