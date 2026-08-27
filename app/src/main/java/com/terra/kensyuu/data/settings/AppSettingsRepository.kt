package com.terra.kensyuu.data.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "terra_settings")

data class AppSettings(
    /** null = システム言語から自動選択（非対応言語は日本語）。 */
    val languageTagOverride: String?,
    val buttonSide: ButtonSide,
    val backupEnabled: Boolean,
    val lastBackupAtMillis: Long?
) {
    companion object {
        val DEFAULT = AppSettings(
            languageTagOverride = null,
            buttonSide = ButtonSide.RIGHT,
            backupEnabled = false,
            lastBackupAtMillis = null
        )
    }
}

/** 言語・ボタン配置・バックアップ設定など、端末ローカルの環境設定を保持する。 */
class AppSettingsRepository(private val context: Context) {

    private object Keys {
        val LANGUAGE_TAG = stringPreferencesKey("language_tag_override")
        val BUTTON_SIDE = stringPreferencesKey("button_side")
        val BACKUP_ENABLED = booleanPreferencesKey("backup_enabled")
        val LAST_BACKUP_AT = longPreferencesKey("last_backup_at")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { prefs ->
        AppSettings(
            languageTagOverride = prefs[Keys.LANGUAGE_TAG],
            buttonSide = prefs[Keys.BUTTON_SIDE]?.let { runCatching { ButtonSide.valueOf(it) }.getOrNull() }
                ?: ButtonSide.RIGHT,
            backupEnabled = prefs[Keys.BACKUP_ENABLED] ?: false,
            lastBackupAtMillis = prefs[Keys.LAST_BACKUP_AT]
        )
    }

    suspend fun setLanguageTag(tag: String?) {
        context.dataStore.edit { prefs ->
            if (tag == null) prefs.remove(Keys.LANGUAGE_TAG) else prefs[Keys.LANGUAGE_TAG] = tag
        }
    }

    suspend fun setButtonSide(side: ButtonSide) {
        context.dataStore.edit { prefs -> prefs[Keys.BUTTON_SIDE] = side.name }
    }

    suspend fun setBackupEnabled(enabled: Boolean) {
        context.dataStore.edit { prefs -> prefs[Keys.BACKUP_ENABLED] = enabled }
    }

    suspend fun setLastBackupAt(millis: Long) {
        context.dataStore.edit { prefs -> prefs[Keys.LAST_BACKUP_AT] = millis }
    }
}
