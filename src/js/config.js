/**
 * 配布ごとに差し替える設定。ここ1か所を書き換えれば全体に反映される。
 */
export const CONFIG = {
  /** アプリ表示名 */
  appName: 'TERRA 検収',

  /** Service Worker のキャッシュ世代。アプリを更新したら必ず上げる */
  cacheVersion: 'terra-kennsyuu-v7',

  /**
   * 音声データを収集するか（将来のオフライン音声認識モデル訓練用）。
   * CLAUDE.mdのロードマップどおり、初版では収集しないため false。
   * false の間は、収集していないものについて同意を求めないよう
   * メニューの同意チェックボックス自体を表示しない。
   * true にする前に、必ず privacy.html に収集内容と利用目的を明記すること。
   */
  voiceDataCollection: false,

  /**
   * Stripe（年額サブスクリプション）
   * 決済プラットフォームは国内向けTERRAアプリ共通でStripeに統一している。
   * テスト用のURLと本番用のURLは別物なので、本番公開時に差し替えること。
   */
  stripe: {
    /** 購入ページ（Stripe Payment Link）。テスト用リンクは test_ を含む */
    checkoutUrl: 'https://buy.stripe.com/test_5kQ00jaRO8yg88a08ofjG00',
    /** 表示用の価格。特商法表記・アプリ内表示と必ず一致させる */
    priceLabel: '年額 9,800円（税込）',
  },

  /**
   * サブスク確認用のサーバーレス関数（同一オリジン）。
   * Stripeのシークレットキーはブラウザに置けないため、ここだけサーバーを通す。
   * 計測・材積計算・保存はすべて端末内で完結し、圏外でも動く。
   */
  api: {
    activate: './api/activate',
    verify: './api/verify',
    portal: './api/portal',
  },

  /** サブスク確認まわりの猶予設定 */
  subscription: {
    /** 初回起動からの試用日数 */
    trialDays: 14,
    /** 最後にオンライン確認できてから、圏外のまま動作を継続できる日数 */
    offlineGraceDays: 30,
    /** オンライン時に再検証する間隔（日） */
    revalidateIntervalDays: 3,
  },

  /** Googleドライブ自動バックアップ（未設定なら機能は自動的に無効表示になる） */
  googleDrive: {
    /** Google Cloud コンソールで発行した OAuth クライアントID */
    clientId: '',
    scope: 'https://www.googleapis.com/auth/drive.file',
    /** バックアップ間隔（時間）。既定は1日1回 */
    intervalHours: 24,
    folderName: 'TERRA検収バックアップ',
  },

  /** 同期リトライの上限（時間）。この間は未同期データを保持し続ける */
  syncRetentionHours: 72,
};
