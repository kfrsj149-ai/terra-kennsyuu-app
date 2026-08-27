package com.terra.kensyuu.util

import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView

/**
 * 炎天下の屋外作業を想定し、計測中は画面消灯を防止し明るさを最大にする。
 * 離脱時（画面破棄時）に元の明るさ設定へ自動的に戻す。
 */
@Composable
fun KeepScreenOnAndBright() {
    val activity = LocalContext.current as? Activity ?: return
    val view = LocalView.current
    DisposableEffect(view) {
        val window = activity.window
        val originalBrightness = window.attributes.screenBrightness
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val layoutParams = window.attributes
        layoutParams.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
        window.attributes = layoutParams

        onDispose {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            val restoredParams = window.attributes
            restoredParams.screenBrightness = originalBrightness
            window.attributes = restoredParams
        }
    }
}
