# タスクリスト: 設定ファイルのJSON分割保存と会話履歴の SQLite 化

## 1. 準備とユーティリティの実装
- [x] サーバー側ファイルシステム用ユーティリティ `app/src/server/utils/fs-helpers.ts` の作成。
    * 一時ファイルを経由したアトミック書き込みを行う `safeWriteFileSync(path, data)` を実装。
- [x] `app/src/server/utils/db.ts` から、前回のフェーズAで作成した `user_configs`, `user_mascots` テーブル定義およびヘルパー（`saveUserConfigToDB`, `getUserMascotsFromDB` 等）を削除。

## 2. サーバー側: 分割JSON設定のAPIと移行処理
- [x] **ユーザー設定 API の実装 (`config.get.ts`, `config.post.ts`)**
    * `config.get.ts`: DBではなく `storage/users/${user_id}/user_config.json` から読み込むように修正。
    * 移行処理の追加: 旧 `config.json` があればロードし、システム設定を `user_config.json`、マスコット設定を各 `mascots/${mascot_id}/mascot_config.json` に展開した上で、旧ファイルを `.imported` に退避。
    * `config.post.ts`: 送信されたシステム設定を `user_config.json` にアトミック保存するように修正。
- [x] **マスコット管理 API の実装 (`server/api/mascots/...`)**
    * `mascots/index.get.ts`: ユーザーの `mascots/` フォルダ配下をスキャンし、各マスコットの `mascot_config.json` を集めて一覧として返却。
    * `mascots/[id].post.ts`: 特定マスコットの `mascot_config.json` をアトミック保存。
    * `mascots/[id].delete.ts`: 指定マスコットのフォルダ（設定＋アセット）を削除。
    * `mascots/index.post.ts` (一括保存): 必要に応じて、全マスコットデータをそれぞれのフォルダに書き出す。

## 3. サーバー側: 会話履歴の SQLite 化 (`chat_histories.db`)
- [x] **会話履歴用 DB マネージャーの作成 (`app/src/server/utils/history-db.ts`)**
    * ユーザーごとに `storage/users/${user_id}/chat_histories.db` を接続・構築。
    * テーブル `chat_sessions`, `session_participants`, `messages` を作成する初期化処理を実装。
    * メッセージ追加・取得用のクエリ関数を実装。
- [x] **会話履歴の自動移行処理の実装**
    * 旧 `chat_history.json` があればロードし、SQLite DB のテーブルへデータを流し込んでインポート。インポート成功後に旧ファイルを `.imported` に退避する。
- [x] **会話履歴 API の改修 (`history.get.ts`, `history.post.ts`)**
    * JSON ファイル直接 of 読み書きから、`history-db.ts` 経由の SQLite 操作に切り替え。

## 4. クライアント側（Electron ＆ フロントエンド）の改修
- [x] **Pinia ストア (`app/src/store/config.ts`) のリファクタリング**
    * `loadConfig` を、`/api/config` と `/api/mascots` を並行ロードしてステートを初期化するように改修。
    * `saveConfig` を、システム設定は `/api/config` へ、マスコットデータは `/api/mascots` への送信に分割。
    * `saveMascot(mascotId)` アクションで個別マスコットの API（`/api/mascots/:id`）を呼ぶように実装。
- [x] **Electron 側 `AppConfig` の軽量化**
    * `app-config.ts` でローカルに保存する `config.json` から `mascots` 配列を除外する。

## 5. テストと動作検証
- [x] サーバー起動時に、古い `config.json` および `chat_history.json` が新構造に自動移行されるか検証。
- [x] 設定更新時、およびメッセージ送信時、それぞれ対応するファイルや `chat_histories.db` が期待通り更新されるか検証。
- [x] 単体テストの再稼働・修正。

