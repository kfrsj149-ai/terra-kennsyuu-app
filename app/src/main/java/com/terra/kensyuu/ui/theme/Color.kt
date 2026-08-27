package com.terra.kensyuu.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.colorResource
import com.terra.kensyuu.R

/**
 * 配色は res/values/colors.xml のみを唯一の情報源とする。ここでは
 * colorResource() で読み込んでComposeのColorSchemeへマッピングしているだけなので、
 * 実地テスト後の色調整は colors.xml の書き換えだけで全画面に反映される。
 */
@Composable
fun terraColorScheme(): ColorScheme = lightColorScheme(
    primary = colorResource(R.color.terra_primary),
    onPrimary = colorResource(R.color.terra_on_primary),
    primaryContainer = colorResource(R.color.terra_primary_variant),
    onPrimaryContainer = colorResource(R.color.terra_on_primary),
    secondary = colorResource(R.color.terra_secondary),
    onSecondary = colorResource(R.color.terra_on_secondary),
    secondaryContainer = colorResource(R.color.terra_secondary_variant),
    onSecondaryContainer = colorResource(R.color.terra_on_secondary),
    background = colorResource(R.color.terra_background),
    onBackground = colorResource(R.color.terra_on_background),
    surface = colorResource(R.color.terra_surface),
    onSurface = colorResource(R.color.terra_on_surface),
    surfaceVariant = colorResource(R.color.terra_surface_variant),
    onSurfaceVariant = colorResource(R.color.terra_on_surface),
    error = colorResource(R.color.terra_error),
    onError = colorResource(R.color.terra_on_primary),
    outline = colorResource(R.color.terra_outline)
)

object TerraExtraColors {
    val cardDefault @Composable get() = colorResource(R.color.terra_card_default)
    val cardDefaultText @Composable get() = colorResource(R.color.terra_card_default_text)
    val cardFlash @Composable get() = colorResource(R.color.terra_card_flash)
    val buttonStart @Composable get() = colorResource(R.color.terra_button_start)
    val buttonCancel @Composable get() = colorResource(R.color.terra_button_cancel)
    val buttonExport @Composable get() = colorResource(R.color.terra_button_export)
    val buttonVoice @Composable get() = colorResource(R.color.terra_button_voice)
    val buttonVoiceActive @Composable get() = colorResource(R.color.terra_button_voice_active)
    val cancelledText @Composable get() = colorResource(R.color.terra_cancelled_text)
    val success @Composable get() = colorResource(R.color.terra_success)
}
