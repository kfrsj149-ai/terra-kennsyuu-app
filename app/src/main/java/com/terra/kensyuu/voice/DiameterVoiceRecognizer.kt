package com.terra.kensyuu.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * オンデバイスの [SpeechRecognizer] をラップし、対象範囲内の径級数値だけを
 * 認識対象として拾い上げる。30〜50分の連続作業でも認識が止まらないよう、
 * 結果・エラーいずれの場合も自動的に聞き取りを再開するループを持つ。
 *
 * 数字の書き取り自体はAndroidのオンデバイス音声認識エンジンに任せ、このクラスは
 * 認識文字列から「対象範囲内の径級として妥当な数値」を抽出する役割に専念する
 * （表記揺れ = 「18」「18cm」「18センチ」等の混在を、数字部分の正規表現抽出で
 * 吸収する）。
 */
class DiameterVoiceRecognizer(
    private val context: Context,
    private val languageTag: String,
    private val listener: Listener
) {
    interface Listener {
        fun onDiameterRecognized(diameterCm: Int)
        fun onListeningChanged(isListening: Boolean)
        fun onRecognitionUnavailable()
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var active = false
    private var allowedDiameters: Set<Int> = emptySet()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val restartDelayMs = 250L

    fun updateAllowedDiameters(diameters: List<Int>) {
        allowedDiameters = diameters.toSet()
    }

    fun start() {
        if (active) return
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            listener.onRecognitionUnavailable()
            return
        }
        active = true
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(recognitionListener)
        }
        listener.onListeningChanged(true)
        listenOnce()
    }

    fun stop() {
        active = false
        speechRecognizer?.let {
            it.stopListening()
            it.destroy()
        }
        speechRecognizer = null
        listener.onListeningChanged(false)
    }

    private fun listenOnce() {
        if (!active) return
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        runCatching { speechRecognizer?.startListening(intent) }
    }

    private fun scheduleRestart() {
        if (!active) return
        mainHandler.postDelayed({ listenOnce() }, restartDelayMs)
    }

    private val recognitionListener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            // ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT 等、作業中は頻繁に起こりうる
            // ものも含め、全エラーで自動再開する（作業を止めないことを最優先）。
            scheduleRestart()
        }

        override fun onResults(results: Bundle?) {
            handleResults(results)
            scheduleRestart()
        }

        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun handleResults(results: Bundle?) {
        val candidates = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
        for (candidate in candidates) {
            val diameter = extractDiameter(candidate) ?: continue
            listener.onDiameterRecognized(diameter)
            return
        }
    }

    /** 認識文字列から、対象範囲内の径級として妥当な最初の数値を抽出する。 */
    private fun extractDiameter(text: String): Int? {
        val numbers = Regex("\\d+").findAll(text).mapNotNull { it.value.toIntOrNull() }.toList()
        for (n in numbers) {
            if (n in allowedDiameters) return n
        }
        return null
    }
}
