# CLI 仕様

## 1. 目的

Codex などの AI エージェントおよび開発者が、ターミナルからサーバーの疎通確認・対話実行・ツール承認・マスコット設定・メモ/タスク操作を行い、結果を機械判定または対話確認できるようにするため、Node.js で実行する CLI を `app/cli/` に配置する。

- CLI は既存の Nitro サーバーへ HTTP / WebSocket で接続し、Mastra ランタイムや履歴ストアを別途起動しない。
- 通常起動（引数なし・オプションのみ）は人間向けの対話モード、`-p` / `--print` / `chat send` および `ping` は機械判定向けの 1 行 JSON 出力とする。

## 2. ファイル構成と実行要件

### 2.1 主な構成ファイル

| パス | 役割 |
| --- | --- |
| `app/cli/index.js` | エントリーポイント。引数解釈と対話モード / JSON モードの振り分け |
| `app/cli/main.js` | 引数解析、環境変数からの接続先解決、`ping` 実行、終了コード整形 |
| `app/cli/chat.js` | `chat send` 入力検証、WebSocket (`/ws`) 接続、ツール承認応答 |
| `app/cli/interactive.js` | 対話モードの入出力制御、Esc / Ctrl+C 処理、`/private` 切替 |
| `app/cli/gui-context.js` | GUI 設定・プロンプト・Mastra Memory 履歴の取得と送信ペイロード構築 |
| `app/cli/mascot-menu.js` | `/mascot`・`/model` の対話メニュー（選択・作成・性格編集・モデル設定） |
| `app/cli/mascots.js` | 既存サーバー HTTP API クライアント |
| `app/cli/data-commands.js` | `/memo`・`/todo` コマンド処理 |
| `app/cli/login.js` | `/login` のブラウザー経由 Google ログイン連携 |
| `app/scripts/dev-nuxt.js` | Nitro / Nuxt 開発サーバー起動スクリプト（ポート・隔離ストレージ対応） |
| `app/scripts/dev-nuxt-options.js` | サーバー起動時のポート環境変数解決および隔離ストレージ設定モジュール |

### 2.2 実行要件

- Node.js 20.6 以降（`--env-file=.env.local` の利用要件。サーバー側の Mastra 実行要件は Node.js 22.13.0 以降）
- `app/` で依存関係（`ws` 等）がインストール済みであること

## 3. 起動方法・環境変数・隔離ストレージ

### 3.1 npm スクリプトと直接起動

| コマンド（`app/` で実行） | 用途 |
| --- | --- |
| `npm run cli` | `app/.env.local` を読み込んで対話モードを起動 |
| `npm run cli -- ping` | サーバー疎通と Mastra 状態を確認（JSON 出力） |
| `npm run cli -- chat send` | 標準入力 JSON から 1 発話を実行（JSON 出力） |
| `npm run dev:cli` | `app/.env.local` を読み込んで Nitro 開発サーバーを起動 |
| `npm run dev:cli:isolated` | `app/.env.local` を読み込みつつ、隔離ストレージで Nitro 開発サーバーを起動 |

- `npm run cli` / `npm run dev:cli` / `npm run dev:cli:isolated` は Node.js の `--env-file=.env.local` を使用するため、`app/.env.local` が必要。既にプロセスへ設定済みの環境変数は `.env.local` より優先される。
- `node cli/index.js` で直接起動する場合は `.env.local` が自動読込されないため、必要に応じて `node --env-file=.env.local cli/index.js` を使用する。
- PowerShell で `npm run cli -- -p` を実行すると npm 側が `-p` を解釈する場合があるため、npm 経由では `npm run cli -- chat send` または `npm run cli -- --print`、直接起動では `node --env-file=.env.local cli/index.js -p` を使用する。

### 3.2 環境変数

| 環境変数 | 適用先 | 内容・優先順位 |
| --- | --- | --- |
| `TONARICE_PORT` | サーバー / CLI | サーバーの `--port` 未指定時、および CLI の `--url` / `TONARICE_CLI_URL` 未指定時に使用するポート番号（1〜65535 の整数）。`PORT` より優先 |
| `PORT` | サーバー / CLI | `TONARICE_PORT` 未指定時に使用するポート番号（1〜65535 の整数） |
| `TONARICE_CLI_URL` | CLI | `--url` 未指定時に使用する接続先オリジン（`TONARICE_PORT` / `PORT` より優先） |
| `TONARICE_AI_API_KEY` | CLI | すべてのエンジンで最優先に使用する AI API キー |
| `OPENAI_API_KEY` | CLI | `engine: "openai"` かつ `TONARICE_AI_API_KEY` 未指定時に使用 |
| `GEMINI_API_KEY` | CLI | `engine: "gemini"` かつ `TONARICE_AI_API_KEY` 未指定時に使用 |
| `TONARICE_SESSION_TOKEN` | CLI | 既存の Google ID トークン。HTTP では Bearer、WebSocket では Cookie (`session_token`) として送信 |
| `MASCOT_STORAGE_DIR` | サーバー | ユーザーデータ保存先ディレクトリ。別 workspace の GUI データを共有する場合に指定 |
| `ALLOW_AUTH_BYPASS` | サーバー | `true` の場合、ローカル開発ユーザー（`usr_local_dev_bypass`）で認証バイパス |

接続先 URL の既定値解決順序は次のとおりとする。

1. CLI 引数 `--url`
2. 環境変数 `TONARICE_CLI_URL`
3. 環境変数 `TONARICE_PORT` → `http://localhost:<ポート番号>`
4. 環境変数 `PORT` → `http://localhost:<ポート番号>`
5. いずれも未指定の場合は `http://localhost:3000`

サーバー起動ポートの解決順序は次のとおりとする。

1. 起動引数 `--port` または `-p`
2. 環境変数 `TONARICE_PORT`
3. 環境変数 `PORT`
4. いずれも未指定の場合は Nuxt 既定（`3000`）

不正なポート番号やオリジン形式が指定された場合は暗黙にフォールバックせずエラー終了する。

### 3.3 隔離ストレージオプション（動作テスト用）

動作テスト時に本番・開発用の共有データを変更しないため、`dev-nuxt.js` は隔離ストレージオプションを提供する。

- `npm run dev:cli:isolated` または `npm run dev:cli -- --isolated-storage`
  - OS の一時ディレクトリ配下に一意のディレクトリ（`tonarice-isolated-storage-*`）を自動作成し、子プロセスの `MASCOT_STORAGE_DIR` を上書きして起動する。
  - サーバー終了時（正常終了 / `SIGINT` / `SIGTERM`）に一時ディレクトリを自動削除する。
- `npm run dev:cli -- --isolated-storage <dir>` または `--isolated-storage=<dir>`
  - 指定ディレクトリ（相対パスは `app/` 基準で解決）を作成し、`MASCOT_STORAGE_DIR` を上書きして起動する。検証後にデータを確認できるよう自動削除は行わない。
- 隔離ストレージ指定時は、通常開発サーバー用の PID 追跡ファイル（`app/node_modules/.cache/tonarice/dev-nuxt.json`）を上書きしない。
- `--isolated-storage` の重複指定や空パス指定はエラーとする。

## 4. 終了コード・出力規約・セキュリティ

### 4.1 終了コード

| 終了コード | エラー種別 (`error.code`) | 意味 |
| --- | --- | --- |
| `0` | — | 正常終了 |
| `2` | `invalid_input` | 引数・JSON 入力・環境変数の形式または範囲が不正 |
| `3` | `auth_error` | 認証失敗（HTTP 401/403、WebSocket 4001/4003） |
| `4` | `connection_error` | サーバー未起動・接続失敗・通信途絶 |
| `5` | `timeout` | 接続または応答のタイムアウト |
| `6` | `server_error` / `invalid_response` / `chat_error` / `dependency_error` / `internal_error` | サーバー処理失敗・応答異常・依存不足・内部エラー |
| `130` | `cancelled` | `SIGINT` (Ctrl+C) または中断シグナルによる終了 |

### 4.2 機械向け JSON 出力形式

`ping` および `chat send` (`-p` / `--print`) は標準出力へ JSON を 1 行出力する。

- 成功時: `{"version":1,"ok":true,"result":{...}}`
- 失敗時: `{"version":1,"ok":false,"error":{"code":"...","message":"..."}}`

### 4.3 セキュリティ要件

- API キーや認証トークンをコマンドライン引数に取らない。
- 資格情報（`TONARICE_SESSION_TOKEN` または API キー）を使用する場合、および `/api/config`・`/login` を利用する場合、接続先は `https:` またはローカル（`localhost` / `127.0.0.1` / `[::1]`）に限定する。
- URL は HTTP または HTTPS のオリジンのみを受け付け、ユーザー情報・パス・クエリ・フラグメント・リダイレクトを拒否する。
- 会話応答以外の内部エラー詳細やサーバー例外本文、API キー・トークンを標準出力やログへ公開しない。

## 5. サブコマンド仕様

### 5.1 `ping`

```bash
node cli/index.js ping [--url <origin>] [--timeout <ms>]
```

- 既定値: `--timeout 5000`、`--url` は第 3.2 節の環境変数規則に従う。
- `GET /api/ping` を呼び出し、`result` に `{ message: "pong", timestamp, mastra }` を返す。認証は不要。

### 5.2 `chat send`（`-p` / `--print`）

```bash
node cli/index.js -p [--url <origin>] [--timeout <ms>]
node cli/index.js --print [--url <origin>] [--timeout <ms>]
node cli/index.js chat send [--url <origin>] [--timeout <ms>]
```

- 既定値: `--timeout 90000`、`--url` は第 3.2 節の環境変数規則に従う。
- 標準入力に 1 MB 以下の JSON オブジェクトを渡す。未対応のフィールドは拒否する。
- 既存の WebSocket (`/ws`) に接続し、1 接続 1 発話のみ実行する。

#### 入力 JSON フィールド

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `message` | 必須 | ユーザー発話文字列（空白のみ不可） |
| `engine` | 必須 | `lmstudio`、`openai`、`gemini` のいずれか |
| `model` | 任意 | モデル ID |
| `systemPrompt` | 任意 | システムプロンプト（GUI 設定やプロンプトは自動取得しない） |
| `lmstudioEndpoint` | 任意 | LM Studio 接続先 URL |
| `history` | 任意 | 一時会話時の過去履歴配列 |
| `activeMascotId` | 条件付必須 | 通常会話保存時のマスコット ID（1〜200 文字） |
| `memorySessionId` | 条件付必須 | 通常会話保存時の会話 ID（1〜200 文字） |
| `memoryUserMessageId` | 条件付必須 | 通常会話保存時のユーザー発話 ID（2 以上の安全な整数） |
| `memoryAssistantMessageId` | 条件付必須 | `memoryUserMessageId` より大きく `8640000000000000` 以下の安全な整数 |
| `turnId` | 任意 | 発話相関 ID（省略時は UUID を自動生成） |
| `temperature` / `frequencyPenalty` / `repetitionPenalty` / `maxOutputTokens` / `enableThinking` | 任意 | 生成パラメーター |
| `enableTools` | 任意 | 真偽値。既定は `false`（TTS・全ツール無効） |
| `tools` | 任意 | `enableTools: true` 時にサーバーへ渡すツール設定オブジェクト |
| `approval` | 任意 | `enableTools: true` 時のみ指定可能。`{"name":"ツール名","input":{...}}` |

入力例:

```json
{"message":"こんにちは","engine":"lmstudio","model":"モデル名","lmstudioEndpoint":"http://127.0.0.1:1234"}
```

#### ツール承認・履歴・中断の規則

- **ツール承認**: 既定ではすべての `tool-approval-request` を拒否する。`approval` を指定した場合のみ、ツール名と正規化済み入力 JSON が完全一致する操作を 1 回だけ承認し、それ以外は拒否する。
- **応答結果 (`result`)**: `{ text, emotion, turnId, approvals }` を返す。ツールによるデータ変更自体の成否は承認の成否とは別であり、応答本文や対象 API で確認する。
- **履歴保存**: `memorySessionId` 等 4 項目を明示した場合のみ、サーバーの Mastra Memory へ通常会話として保存する。未指定時は一時会話となり保存しない。`chat send` 用の履歴一覧・削除サブコマンドは未実装。
- **タイムアウト・切断・中断**: 送信後の切断・タイムアウト・中断時は自動再送せず、処理結果が不明である旨を返す。Ctrl+C でプロセスを終了し WebSocket を閉じる。

### 5.3 `chat interactive`（対話モード）

```bash
npm run cli [-- --engine <engine> --model <id> --lmstudio-endpoint <url> --system-prompt <text> --url <origin> --timeout <ms>]
```

- 引数なしまたはオプションのみ指定した場合に対話モードで起動し、1 行ずつマスコットと会話できる。標準入力パイプによる非 TTY 実行にも対応する。
- 人間が読むテキスト形式で出力する（機械向け JSON が必要な場合は `chat send` を使用する）。

#### 対話コマンド一覧

| コマンド | 動作 |
| --- | --- |
| `/help` | 利用可能なコマンド一覧を表示 |
| `/login` | ブラウザーで Google ログインを開き、1 回限り有効（5 分期限・検証値付き）の認証トークンをメモリ内へ取得。アカウント混在防止のため会話文脈とマスコット選択を初期化 |
| `/mascot` | マスコット一覧を表示。番号で選択、`c` で新規作成、`p` で選択中マスコットの性格編集（複数行入力 → `/save` で保存、`/empty` で空保存、`/cancel` または Esc で破棄。保存失敗時は入力保持） |
| `/model` | 選択中マスコットの現在のエンジン・モデルを表示し、番号とモデル ID 手入力で更新（`/cancel` / Esc で中止） |
| `/history` | Mastra Memory に保存された通常会話一覧を表示・選択し、直近 10 件を表示（プライベート会話中は通常会話へ戻るよう案内） |
| `/clear` | 通常会話では履歴を削除せず新しい会話 ID を開始。プライベート会話ではメモリ上の文脈を消去 |
| `/private` | 通常会話とプライベート会話を切り替え。プライベート会話は通常履歴を読まず CLI メモリ内のみに直近 10 件を保持し、切り替え・終了時に破棄（AI サービスへは内容が送信される） |
| `/memo [help\|list\|add 内容\|edit ID 内容\|delete ID]` | ユーザーのメモ一覧表示および個別更新 |
| `/todo [help\|list\|add 内容\|edit ID 内容\|delete ID\|done ID\|reopen ID]` | ユーザーのタスク一覧表示および個別更新 |
| `/exit` / `/quit` / EOF | 対話モードを正常終了（終了コード `0`） |

#### キー操作とエラー処理

- **Esc**（端末実行時）: メニュー入力中・性格編集中は操作を取り消し、応答待ち・ログイン待ち中は通信を中断して入力に戻る（送信後の処理結果は不明と表示）。
- **Ctrl+C**: 終了コード `130` で終了する。
- **通信エラー**: エラーメッセージを表示して入力へ戻り、失敗発話は履歴へ追加しない。自動再送は行わない。

#### GUI との設定・履歴共有範囲

- 最初の送信前に GUI のアクティブマスコット ID を参照し、見つからなければ一覧の先頭を選択する（マスコット選択自体は CLI 内にのみ適用）。
- 通常の対話では GUI と同様にグローバルのエンジン・モデルをマスコット固有設定より優先し、API キー、LM Studio 接続先、生成パラメーターを取得する。優先順位は「CLI 起動オプション / 環境変数 API キー ＞ CLI 内 `/model` 変更（選択中のみ） ＞ GUI グローバル設定 ＞ マスコット固有設定」。
- マスコットのプロフィールおよびワークスペース内のプロンプトファイル（`/api/mascots/cli-prompts`）をシステムプロンプトへ組み込む。プロフィール・チャット設定は各マスコットの `config.yaml` に保存し、従来の `mascot_config.json` と互換読み込みを維持する。
- GUI と同じ Mastra Memory を利用し、初期状態では最新の通常会話を選ぶ。生成成功時の発話はサーバーへ保存され、GUI 側で履歴を再読み込みすれば参照できる。
- **非共有範囲**: GUI のブラウザー内ローカルストレージにのみ存在する「現在選択中の会話 ID」「ローカル専用プロンプト」「シークレット会話」は共有しない。
- 対話モードでは TTS と AI ツールを無効とする。
- `/memo`・`/todo` の変更はプライベート会話中でも通常データへ永続化され、同一ユーザーの接続中 GUI へ既存の同期イベントを配信する。

## 6. サーバー連携経路

| 経路 | 用途 |
| --- | --- |
| `WS /ws` | 対話送受信 (`chat-send`, `chat-response`, `chat-error`)、ツール承認 (`tool-approval-request`, `tool-approval-response`) |
| `GET /api/ping` | 疎通確認・Mastra 初期化状態取得 |
| `GET /api/config` | アクティブマスコット ID・グローバル AI 設定・生成パラメーター取得 |
| `GET /api/mascots` / `POST /api/mascots/cli` | マスコット一覧取得、作成、性格・モデル更新 |
| `GET /api/mascots/cli-prompts` | ワークスペース内のマスコット用プロンプトファイル取得 |
| `GET /api/mastra-history` | マスコット別の Mastra Memory 通常会話一覧取得 |
| `GET /api/memos` / `GET /api/tasks` | メモ・タスク一覧取得 |
| `POST /api/cli-data` | メモ・タスクの個別追加・更新・削除および同一ユーザー GUI への同期通知 (`user-connections.ts`) |

## 7. 動作テスト時の利用ガイド（エージェント・開発者向け）

モックではなく実 Nitro サーバー・実モデルを使った対話や副作用の動作テストを行う場合は、次の手順で本番・開発データおよび既存開発サーバーから分離して実行する。

1. **ポート分離**: 別 workspace の開発サーバーと衝突しないポートを環境変数（例: `TONARICE_PORT=3010`）で指定する。
2. **隔離サーバー起動**: `app/` で `npm run dev:cli:isolated`（検証後にデータ内容を確認したい場合は `npm run dev:cli -- --isolated-storage <一時パス>`）を実行する。既存の Nuxt / Electron 開発プロセスは停止・再起動しない。
3. **疎通確認**: `npm run cli -- ping` で `ok: true` と `mastra.enabled: true` を確認する。
4. **機械判定テスト**: `npm run cli -- chat send`（または `node --env-file=.env.local cli/index.js -p`）へ JSON を渡し、終了コード・`ok`・`result.text`・`result.approvals` および隔離サーバーの API（`/api/mastra-history`, `/api/memos`, `/api/tasks`）で結果を判定する。
5. **情報保護**: API キー・認証トークン・`.env.local` の内容および不要な会話本文をログ・報告・コミットへ含めない。
