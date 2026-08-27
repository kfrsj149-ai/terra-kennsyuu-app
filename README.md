# TERRA — 丸太検収アプリ

山林・製材工場での丸太検収作業向け、完全ローカル完結型のAndroidネイティブアプリ。

## 開発環境について（重要）

このプロジェクトはネットワーク制限のあるサンドボックス環境で生成されており、
`dl.google.com`（Android SDKのプラットフォーム/ビルドツール配布元）へ到達できな
かったため、**このセッション内では実機/エミュレータ向けのAPKビルド検証を行えて
いません**。Android Studio（Android SDK込み）がある通常の開発環境であれば、
`./gradlew assembleDebug` で問題なくビルドできる構成にしてあります。

JAS材積計算エンジン（`JasVolumeCalculator`）だけは、Android SDKに依存しない純粋
なKotlin/BigDecimal実装のため、このサンドボックス内でも独立したJVMプロジェクト
としてJUnitテストを実際に実行し、仕様書のテストケース（12m材・径級6〜72cm・
合計38本 = 166.698m³、短尺式誤用時 = 92.112m³、過小評価率44.74%）が正しく再現
されることを確認済みです（`app/src/test/java/.../JasVolumeCalculatorTest.kt`）。

## ビルド方法

```
./gradlew assembleDebug   # デバッグAPK
./gradlew test            # JVM単体テスト（JAS計算エンジン等）
```

Android Studio で開く場合はプロジェクトルートを開くだけで自動的にGradle同期が
走ります。

## Googleドライブ自動バックアップを有効にするための追加設定

`data/backup/` 配下のコードはGoogle Sign-In + Drive API (appDataFolderスコープ)
を使った自動バックアップの実装ですが、以下は開発者側で一度だけ行うセットアップ
が必要です（アプリ本体の完全オフライン思想には反しない、任意の裏機能です）。

1. Google Cloud Consoleでプロジェクトを作成し、Drive APIを有効化
2. OAuth同意画面を設定
3. Android用OAuthクライアントIDを発行し、アプリの署名SHA-1を登録
4. `google-services.json` 等の必要な設定ファイルをプロジェクトに配置

これらを行わない状態でもアプリ本体（検収・計算・CSV出力・音声入力など）は
問題なく動作します。バックアップ機能はメニューの「自動バックアップ」から
サインインするまで無効のままです。

## プロジェクト構成

```
app/src/main/java/com/terra/kensyuu/
  calc/          JAS材積計算エンジン（最優先で実装・検証済み）
  data/db/       Room DB（会社名・車番・よく使う設定・伝票・明細）
  data/repository/  DAOとJAS計算をつなぐユースケース層
  data/settings/ DataStoreベースの環境設定（言語・ボタン配置・バックアップ）
  data/export/   CSV出力・共有Intent
  data/backup/   Googleドライブ自動バックアップ（WorkManager）
  voice/         オンデバイス音声入力（SpeechRecognizer）
  ui/            Jetpack Compose画面一式（setup/measurement/menu/navigation/theme）
```

配色は `res/values/colors.xml` が唯一の情報源です。実地テスト後の色調整は
このファイルの書き換えだけで全画面に反映されます。

多言語対応（日本語デフォルト／ベトナム語／タガログ語／タイ語／マレー語）は
`res/values*/strings.xml` に分離されており、CSVヘッダーも選択言語で出力され
ます。
