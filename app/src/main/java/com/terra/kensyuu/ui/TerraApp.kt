package com.terra.kensyuu.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.terra.kensyuu.TerraApplication

/** Composableから手動DIコンテナ(Application)を取得するための小さなヘルパー。 */
@Composable
fun terraApplication(): TerraApplication = LocalContext.current.applicationContext as TerraApplication
