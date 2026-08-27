package com.terra.kensyuu.data.settings

import androidx.annotation.StringRes
import com.terra.kensyuu.R

/**
 * TERRA が対応する表示言語。[tag] は BCP-47 言語タグで、リソース修飾子
 * (values-vi 等)やCSVヘッダー選択のキーとして使う。
 */
enum class AppLanguage(val tag: String, @StringRes val displayNameRes: Int) {
    JAPANESE("ja", R.string.language_japanese),
    VIETNAMESE("vi", R.string.language_vietnamese),
    TAGALOG("tl", R.string.language_tagalog),
    THAI("th", R.string.language_thai),
    MALAY("ms", R.string.language_malay);

    companion object {
        val DEFAULT = JAPANESE

        fun fromTag(tag: String?): AppLanguage =
            entries.firstOrNull { it.tag == tag } ?: DEFAULT

        /** デバイスのシステム言語から対応言語を推定する。非対応言語は日本語。 */
        fun fromSystemLocaleTag(languageTag: String): AppLanguage =
            entries.firstOrNull { languageTag.startsWith(it.tag) } ?: DEFAULT

        /** ユーザーが手動選択していれば優先し、なければシステム言語から自動選択する。 */
        fun resolveEffective(overrideTag: String?, systemLocaleTag: String): AppLanguage =
            overrideTag?.let { fromTag(it) } ?: fromSystemLocaleTag(systemLocaleTag)
    }
}
