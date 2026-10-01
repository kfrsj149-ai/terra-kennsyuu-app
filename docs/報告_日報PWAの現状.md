# 日報PWA（NIPPO-RA）現状報告（記録）

> 2026-10-01。日報PWAのClaudeがコードを調べて返した報告を、神田さん経由で受け取った。
> **丸太検収側のClaudeは、このコードを見ていない。以下は報告の内容であり、未検証。**
> 報告者側のリポジトリにも `docs/concept-notes/2026-10-01-machine-qr-survey-report.md` として保存済み（コミット `0afd3db`）。

## 報告の要点

| 項目 | 内容 |
| --- | --- |
| 構成 | フレームワークなし（素のJS）、esbuildでバンドル |
| サーバー | Firebase（Firestore、プロジェクトID `terra-nippo-ra`）。匿名認証＋許可リスト |
| 利用者の持ち方 | 会社は `TERRA` 固定（`/companies/TERRA/…`）。**単一の会社向け**で、複数の会社に分ける作りではない |
| ホスティング | Firebase Hosting（`terra-nippo-ra.web.app` 系）。`terra-tx-jp.com` は未設定 |
| 課金 | なし |
| 機械台帳 | `/companies/TERRA/machines/{machineId}`。name・type・ownershipType・status・attachmentMode・compatibleWorkItemIds・mainOperatorId・possibleOperatorIds・deleted。**アワーメーターの項目なし** |
| 機械ID | Firestoreの自動ID（約20文字）。**免税軽油とは別のFirebaseプロジェクト** |
| 同期 | 「事務所端末への片方向同期」はなく、**全端末が同じFirestoreを直接共有** |
| アワーメーター | **未実装**（OCRも保存先もない）。稼働時間は数値ではなく `timeSlot`（午前／午後／全日の3択） |
| QR | **使っていない。** 構想メモ `docs/concept-notes/2026-09-12-qr-scan-entry.md` が1件あるのみ（クエリ方式＋Firestore自動IDの再利用を想定していて、新しい規格と食い違う） |
| Service Worker | キャッシュ名 `nippo-ra-shell-<ビルドハッシュ>`。`activate` で**自分の名前以外のキャッシュを全削除**（同じドメインに同居すると他アプリを壊す）。IndexedDB名はFirebase SDK既定 |
| 日報 | 現場・天候・路面・風速・参加作業員・稼働時間帯（3択）を記録。入力は本人または代表の一括。**閲覧は会社内の許可済み端末なら誰でも可**（個人・班の閲覧制限なし） |
| 点検 | 未作成 |

## 報告者の懸念

1. QR規格が新旧で食い違う（パス方式＋サーバー発行の8桁IDと、既存メモのクエリ方式＋Firestore自動ID）。再設計が必要
2. Service Workerのキャッシュ全削除は、他のアプリも横並びで点検すべき
3. 権限がフラット。免税軽油・点検がより細かい権限分離を必要とするなら、統合時に権限モデルの再設計が必要
4. 点検は個人責任の記録にすべきか。異常時の連絡には、フラットな権限設計では足りない
