package com.terra.kensyuu.voice

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

class VoiceInputState(
    val isListening: Boolean,
    val hasPermission: Boolean,
    val toggle: () -> Unit
)

/**
 * 音声入力のライフサイクル（録音権限の要求、[DiameterVoiceRecognizer]の
 * 生成・破棄、認識結果のコールバック）をComposeの画面ライフサイクルに束縛する。
 */
@Composable
fun rememberVoiceInputState(
    languageTag: String,
    allowedDiameters: List<Int>,
    onDiameterRecognized: (Int) -> Unit
): VoiceInputState {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var isListening by remember { mutableStateOf(false) }
    var startRequested by remember { mutableStateOf(false) }
    val onDiameterRecognizedState = rememberUpdatedState(onDiameterRecognized)

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasPermission = granted
        if (granted) startRequested = true
    }

    val recognizer = remember(languageTag) {
        DiameterVoiceRecognizer(
            context = context,
            languageTag = languageTag,
            listener = object : DiameterVoiceRecognizer.Listener {
                override fun onDiameterRecognized(diameterCm: Int) {
                    onDiameterRecognizedState.value(diameterCm)
                }

                override fun onListeningChanged(listening: Boolean) {
                    isListening = listening
                }

                override fun onRecognitionUnavailable() {
                    isListening = false
                }
            }
        )
    }

    DisposableEffect(recognizer) {
        onDispose { recognizer.stop() }
    }

    DisposableEffect(allowedDiameters) {
        recognizer.updateAllowedDiameters(allowedDiameters)
        onDispose {}
    }

    DisposableEffect(startRequested) {
        if (startRequested) {
            recognizer.start()
            startRequested = false
        }
        onDispose {}
    }

    val toggle: () -> Unit = {
        if (isListening) {
            recognizer.stop()
        } else if (hasPermission) {
            recognizer.start()
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    return VoiceInputState(isListening = isListening, hasPermission = hasPermission, toggle = toggle)
}
