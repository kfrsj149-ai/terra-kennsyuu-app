package com.terra.kensyuu.data.backup

import android.accounts.Account
import android.content.Context
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import com.google.api.services.drive.DriveScopes

/**
 * Googleドライブへのバックアップに使うアカウント連携。
 *
 * NOTE: 実機でGoogleサインインを動かすには、Google Cloud Console 側で
 * OAuthクライアント（Android用）を発行し、アプリの署名SHA-1を登録した上で
 * google-services.json をこのプロジェクトに配置する必要がある（開発者側の
 * 一回限りのセットアップ）。ここではその前提でコードのみを用意している。
 *
 * スコープは DRIVE_APPDATA（アプリ専用の非公開領域）のみを要求し、ユーザーの
 * Googleドライブ全体へはアクセスしない。
 */
object GoogleSignInHelper {

    fun signInOptions(): GoogleSignInOptions =
        GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestScopes(Scope(DriveScopes.DRIVE_APPDATA))
            .build()

    fun client(context: Context): GoogleSignInClient = GoogleSignIn.getClient(context, signInOptions())

    fun lastSignedInAccount(context: Context): GoogleSignInAccount? =
        GoogleSignIn.getLastSignedInAccount(context)

    fun toAndroidAccount(account: GoogleSignInAccount): Account? = account.account
}
