/**
 * 配布ごとに差し替える設定。ここ1か所を書き換えれば全体に反映される。
 */
export const CONFIG = {
  /** アプリ表示名 */
  appName: 'TERRA 検収',

  /** Service Worker のキャッシュ世代。アプリを更新したら必ず上げる */
  cacheVersion: 'terra-kennsyuu-v1',

  /** Lemon Squeezy（年額サブスクリプション） */
  lemonSqueezy: {
    /** ライセンス検証APIのエンドポイント（Lemon Squeezy標準） */
    validateUrl: 'https://api.lemonsqueezy.com/v1/licenses/validate',
    activateUrl: 'https://api.lemonsqueezy.com/v1/licenses/activate',
    /** 購入ページURL（ストアの商品URLに差し替える） */
    checkoutUrl: '',
    /** 顧客ポータル（支払い・プラン管理）URL */
    portalUrl: 'https://app.lemonsqueezy.com/my-orders',
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
