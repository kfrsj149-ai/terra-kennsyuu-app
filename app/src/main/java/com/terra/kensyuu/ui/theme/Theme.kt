package com.terra.kensyuu.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable

/**
 * TERRAは常にライトテーマ（炎天下での視認性優先、ダークモードは提供しない）。
 */
@Composable
fun TerraTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = terraColorScheme(),
        typography = TerraTypography,
        content = content
    )
}
