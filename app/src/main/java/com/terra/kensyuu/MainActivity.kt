package com.terra.kensyuu

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import com.terra.kensyuu.ui.navigation.TerraRoot
import com.terra.kensyuu.ui.theme.TerraTheme

/**
 * AppCompatActivity を使うのは、AppCompatDelegate.setApplicationLocales() による
 * アプリ内言語切替をAPI 33未満でも自動的に永続化・再適用させるため
 * （Composeのみのアプリでは通常 ComponentActivity で十分だが、per-app language
 * のバックポート挙動はAppCompatActivityのライフサイクルに依存する）。
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TerraTheme {
                TerraRoot()
            }
        }
    }
}
