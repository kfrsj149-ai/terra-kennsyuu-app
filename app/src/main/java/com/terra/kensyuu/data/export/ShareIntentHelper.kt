package com.terra.kensyuu.data.export

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.terra.kensyuu.R
import java.io.File

/**
 * Android標準の共有ダイアログ(ACTION_SEND)を使う。共有先アプリの個別実装は行わず、
 * 端末にインストールされている全ての共有可能アプリをOS側にリスト表示させる。
 */
object ShareIntentHelper {

    fun shareCsv(context: Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/csv"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(sendIntent, context.getString(R.string.output_share_chooser_title))
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
    }
}
