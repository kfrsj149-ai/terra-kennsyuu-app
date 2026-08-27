package com.terra.kensyuu.util

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback

/**
 * 径級カードタップ時の3つのフィードバック（発光はカード側で担当、ここでは
 * 振動＋操作音）をまとめて発火する。手袋着用・騒音下でも操作結果が分かるように。
 */
class TapFeedback(
    private val haptic: HapticFeedback,
    private val toneGenerator: ToneGenerator?
) {
    fun onTap() {
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, 60)
    }

    fun onUndo() {
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        toneGenerator?.startTone(ToneGenerator.TONE_PROP_NACK, 120)
    }
}

@Composable
fun rememberTapFeedback(context: Context = androidx.compose.ui.platform.LocalContext.current): TapFeedback {
    val haptic = LocalHapticFeedback.current
    val toneGenerator = remember {
        runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70) }.getOrNull()
    }
    DisposableEffect(Unit) {
        onDispose { toneGenerator?.release() }
    }
    return remember(haptic, toneGenerator) { TapFeedback(haptic, toneGenerator) }
}
