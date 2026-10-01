# 免税軽油PWA 現状報告（記録）

> 2026-10-01。免税軽油PWAのClaudeがコードを調べて返した報告を、神田さん経由で受け取った。
> **丸太検収側のClaudeは、このコードを見ていない。以下は報告の内容であり、未検証。**
> 元の質問票は `docs/機械まわりアプリへの共有.md`。

## 報告の要点

| 項目 | 内容 |
| --- | --- |
| 構成 | Vite + React 19 + TypeScript（ビルドあり）。npm workspacesのモノレポ（field-pwa / office-dashboard / shared） |
| サーバー | Firebase（Firestore asia-northeast1、Cloud Storage）。事務所側はGoogleログイン、現場端末は匿名認証＋招待トークンで会社に所属 |
| 機械台帳 | `companies/{companyId}/machines/{machineId}`。名称・型式・区分・QR URL・メーター種別（digital/analog）・免税軽油制度の項目 |
| 機械ID | Firestoreの自動ID（約20文字）。会社サブコレクション配下にある |
| アワーメーター | digitalはOCR（tesseract.js・端末内）、analogは手入力。`companies/{companyId}/refuelLogs/{logId}` に1給油=1レコード（機械・作業員・時刻・確定値） |
| 同期 | Firestoreのリアルタイムリスナー（事務所側へプッシュ） |
| 課金 | Stripe（Checkout＋Webhook）。サブスク状態はFirestoreの `T_Company_SubscriptionStatus`。シークレットキーはVercel Functionsのみ |
| ホスティング | Vercel（`field-pwa-red.vercel.app` / `office-pwa.vercel.app`）。カスタムドメインなし |
| QR | あり。機体QRは `field-pwa-red.vercel.app/scan?machine_id=<Firestore ID>`（読むと作業員・機体選択を飛ばして撮影画面へ）。端末登録用の招待QRは `/setup?company=…&token=…`。**QR一括PDF印刷機能（Phase 11）は実装済み** |
| Service Worker | field-pwaにあり。`activate` で自分以外のキャッシュ名を全削除する作り（同じドメインに同居すると他アプリを壊す）。office-dashboardにはSWなし |
| 日報・点検 | **存在しない**（コード検索で確認したと報告） |
| 開発理念 | 「行政書士法に抵触しうる機能は実装しない」「現場の1秒完了を最優先」 |

## 報告者の懸念

1. 機械IDが会社スコープのFirestore自動IDで、8文字のグローバルIDとは非互換
2. QR印刷が実装済みで、すでに現場で使われている可能性がある（刷り直しの懸念）
3. Service Workerの全削除は、同じドメインに同居させるなら修正必須
4. 日報は労働時間の記録になりうる。開発理念・権限設計との整合を事業体ごとに検討する必要がある

## 丸太検収側の見立て（案・神田さんの確認待ち）

`docs/QR書式の統一.md` の「調査結果を受けた見直し案」に記載。
