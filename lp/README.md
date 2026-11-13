# LOG-RA のランディングページ（下書き）

`lp/log-ra/` が、LOG-RA の紹介ページ（LP）の下書きです。**いまは購入リンクを入れていません。**
公開先は、アプリ（Vercel）ではなく、TERRA TX のサイト（Firebase Hosting）の `https://terra-tx-jp.com/log-ra/` です。
このリポジトリにあるのは、**置き場所の確認用の控え**です（アプリのドメインでは検索に出ないよう `noindex` にしてあります）。

## 中身
- `index.html` … ページ本体（CSS・JSは中に入っている）
- `shots/ja/` … アプリの実画面のスクリーンショット4枚（準備・計測・出力確認・紙伝票）
- `og-image.jpg` … SNSで共有したときの画像（1200×630）

## テーマカラー
- ベース：TERRA TX 共通の深い森の緑（トップページ・Logging Scorer と同じ）
- 木口（こぐち）クリーム `#f1dfb0` … 丸太の切り口の色。見出し・数字・価格
- 検収朱 `#d9402a` … 検収の印の朱。ボタン・強調（Logging Scorer の橙・ライムとは別の色）
- 色は、`index.html` の先頭の `:root` だけを書き換えれば、全体に反映されます

## 公開するときにやること（神田さんのOKのあと）
1. PCの `C:\Users\user\terra-tx-jitsugi-site\public\log-ra\` に、この `lp/log-ra/` の中身を、そのままコピーする（`index.html`・`shots\`・`og-image.jpg`）
2. `index.html` を直す
   - 先頭近くの「下書き」の帯（`<div class="draft">`）を、1行ごと消す
   - 購入ボタン `#buy` の `data-early`（2026-12-31 までのリンク）と `data-normal`（2027-01-01 からのリンク）に、**本番の購入リンク**を入れる。空のあいだは、ボタンが「準備中」と出て、押せない
   - フッターの法務リンクは、いまはアプリ側（`log-ra.terra-tx-jp.com/legal/…`）を指している。Scorer と同じ形にするなら、`public\log-ra\legal\` にコピーして、リンクを直す
3. `public\sitemap.xml` に `https://terra-tx-jp.com/log-ra/` を1行足す
4. 公開：`firebase deploy --only hosting --project terra-tx-jitsugi`（**`public` フォルダ全体で本番が置き換わる。別フォルダでは実行しない**）
5. Search Console で、`https://terra-tx-jp.com/log-ra/` のインデックス登録をリクエストする

## 日付による自動切り替え
ページの中の小さなJSが、日本時間で `2026-12-31` までは「初年度の特典」の表示と購入リンク、2027-01-01 からは通常の表示と購入リンクに切り替える（アプリの `src/js/pricing.js` と同じ考え方）。
**2026-12-31 までに、通常価格の購入リンクを作って `data-normal` に入れる**こと（空だと、年明けから「準備中」になる）。

## 注意
- 料金・金額は、アプリ内の表示・特商法・Stripe と必ず一致させる（アプリ側は `tests/pricing.test.js` が確かめている）。金額を変えるときは、このページの数字も直す
- 言語は日本語のみ。アプリは5言語（日・越・タガログ・タイ・マレー）なので、LPの多言語化は、あとで足す
