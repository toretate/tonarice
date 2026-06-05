# Web版（ブラウザ動作版）実装タスクリスト

- [x] `vite.config.web.ts` の新規作成（ViteのWebビルド設定）
- [x] `ui/web/index.html` の新規作成（WebエントリーHTML）
- [x] `ui/web/main.ts` の新規作成（Webエントリーポイント）
- [x] `ui/src/utils/browser-polyfill.ts` の新規作成（Electron APIのブラウザエミュレート）
- [x] `ui/src/App.vue` のハッシュルーティング調整（初期状態で `IntegratedLayout` を表示）
- [x] `ui/src/components/chatpanel/useChatHistory.ts` の `localStorage` への永続化対応（保存・読込のWebフォールバック）
- [x] `ui/package.json` への開発/ビルドコマンド追加
- [x] Web版ビルド検証（`npm run build:web`）
- [x] 完了報告書の作成（`docs/web_version_implementation/walkthrough.md`）

## 設定共有（環境一元化）タスク
- [x] `ui/electron/app-config.ts` で開発モード時の設定ファイルパスをプロジェクトルートの `config.json` に変更
- [x] `server/src/middlewares/auth-middleware.ts` で localhost からのリクエストに対する認証バイパス処理の追加
- [x] `ui/src/utils/browser-polyfill.ts` でサーバー設定の優先取得とセーブ処理の実装
- [x] 動作確認および最終ビルド検証

