package com.terra.kensyuu.data.backup

import android.accounts.Account
import android.content.Context
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.drive.Drive
import com.google.api.services.drive.DriveScopes
import com.google.api.services.drive.model.File as DriveFile
import java.io.File as JavaFile

/**
 * Room DBファイルを Google Drive のアプリ専用領域(appDataFolder)へアップロード
 * する。appDataFolder はユーザーの通常のドライブ画面には表示されない、
 * アプリ専用の隠し領域のため、バックアップ用途に最小権限で対応できる。
 * 同名ファイルが既に存在する場合は新規作成せず上書き更新する。
 */
object DriveBackupUploader {

    private const val BACKUP_FILE_NAME = "terra_backup.db"

    private fun buildService(context: Context, account: Account): Drive {
        val credential = GoogleAccountCredential.usingOAuth2(context, listOf(DriveScopes.DRIVE_APPDATA))
        credential.selectedAccount = account
        return Drive.Builder(NetHttpTransport(), GsonFactory.getDefaultInstance(), credential)
            .setApplicationName("TERRA")
            .build()
    }

    fun uploadDatabaseBackup(context: Context, account: Account, databaseFile: JavaFile) {
        if (!databaseFile.exists()) return
        val drive = buildService(context, account)

        val existing = drive.files().list()
            .setSpaces("appDataFolder")
            .setQ("name = '$BACKUP_FILE_NAME'")
            .setFields("files(id, name)")
            .execute()
            .files
            .firstOrNull()

        val content = com.google.api.client.http.FileContent("application/octet-stream", databaseFile)

        if (existing != null) {
            drive.files().update(existing.id, null, content).execute()
        } else {
            val metadata = DriveFile().apply {
                name = BACKUP_FILE_NAME
                parents = listOf("appDataFolder")
            }
            drive.files().create(metadata, content).execute()
        }
    }
}
