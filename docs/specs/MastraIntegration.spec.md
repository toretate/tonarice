# Mastra 統合仕様

## 1. 目的

MastraをAIエージェントのオーケストレーション基盤として段階導入し、既存のチャット、WebSocket、TTS、ツール、スケジュールプロンプトを維持しながらAgent、Memory、Workflow、Observabilityを評価できる構成にする。

## 2. 適用範囲

フェーズ1・2では次を対象とする。

- `@mastra/core`によるMastraランタイムとAgentの生成
- Nitroサーバープロセス内での遅延初期化
- Request Contextによるリクエスト単位のモデル選択
- 機能フラグによるGemini/OpenAI対話チャットのLegacy/Mastra経路切り替え
- 既存履歴、テキスト・画像添付、システムプロンプトのAgent入力への変換
- 既存WebSocketのチャット応答、TTS、感情タグ、タイマーイベントとの接続
- NitroビルドとElectron内蔵Node.jsでの実行互換性確認

次は後続フェーズとする。

- Mastraツールと既存ツールの共通化
- LM Studio固有オプションの完全移植
- Mastra MemoryとLibSQL
- Workflow、Studio、MCP、外部Observability
- Legacy AI経路の削除

## 3. 実行アーキテクチャ

- MastraランタイムはNitroサーバープロセスだけに配置する。
- ElectronメインプロセスにはMastraを生成しない。
- 独立したMastraサーバーや追加の待受ポートを作成しない。
- Mastra関連コードは`app/src/server/mastra/`以下へ配置する。
- MastraインスタンスとAgentは、最初に必要になった時点で一度だけ生成する。
- Nitroの`/api/ping`はMastra機能の有効状態と初期化状態を返す。

## 4. 機能フラグ

- 環境変数`MASTRA_CHAT_ENABLED`でMastraチャット経路を制御する。
- `true`または`1`の場合だけ有効とする。大文字・小文字と前後空白は無視する。
- 未指定、空文字、その他の値は無効として扱う。
- 正式切り替えまでは未指定時の既定値を無効とする。
- 機能フラグ無効時はMastraインスタンスを生成しない。
- フラグ有効時はGemini/OpenAIの対話チャットだけをMastraへ送る。LM Studioと他のAI処理は既存経路を使う。
- フェーズ2のMastra経路はツールを実行しない試験経路とする。既存のタスク・メモツールは常時有効なため、フラグ有効時の操作依頼では実行済みを装わず利用不可を伝える。
- Mastra経路で処理を始めた後、失敗時に既存経路へ自動再送しない。

## 5. Agentとモデル

- Agent IDは`mascot-agent`とする。
- 初期導入ではツール、Memory、WorkflowをAgentへ登録しない。
- 現行処理と同じく、最初は全文を返す`agent.generate()`を使用する。
- モデルはAgentへ固定せず、実行ごとのRequest Contextから解決する。
- APIキー、認証トークン、LM Studioの資格情報をRequest Contextへ直接格納しない。
- APIキーを使って生成したモデルオブジェクトをリクエスト単位で渡し、認証情報を持つモデルをリクエスト間でキャッシュしない。
- OpenAIはResponses APIを使用する。制限付きキーには`api.responses.write`権限が必要である。
- Request Contextへ格納できる識別情報はエンジン名とモデルIDに限定する。
- システムプロンプトはRequest Contextへ格納せず、Agent実行オプションとして渡す。
- 会話履歴と添付ファイルは実行時のメッセージとして渡し、フェーズ2ではMastra Memoryへ保存しない。
- 画像はBase64データをリクエストへ直接含めるため、OpenAI Files APIへの事前アップロードを行わない。
- 生成タイムアウトは60秒とし、WebSocket切断時は実行中のMastra呼出しを中断する。
- Agentは全文を返し、既存WebSocketの応答・TTS処理へ渡す。ストリーミングは別途評価する。

## 6. ログとトレース

- 初期段階では外部Observabilityエクスポーターを設定しない。
- Request Contextのスパン情報へAPIキー、認証トークン、システムプロンプト、ユーザーメッセージを含めない。
- ログへ出力できるのはMastraの有効状態、初期化状態、エンジン名、モデルID、処理結果、所要時間である。
- モデルオブジェクト全体やリクエスト本文をログへ出力しない。
- Mastra経路のエラー時はAPI応答本文と例外メッセージをクライアントへ転送せず、固定の日本語エラー文を返す。

## 7. ヘルスチェック

`GET /api/ping`は従来の応答に次を追加する。

```json
{
    "mastra": {
        "enabled": false,
        "initialized": false
    }
}
```

- `enabled`は機能フラグの評価結果を表す。
- `initialized`は現在のNitroプロセス内でMastraインスタンスが生成済みかを表す。
- ヘルスチェックはMastraを初期化しない。
- APIキー、モデル設定、エラー詳細を返さない。

## 8. ビルドと配布

- 最初にNitroの既定バンドル設定でビルドする。
- `@mastra/core`を外部化するのは、既定バンドルでビルドまたは実行上の問題が確認された場合だけとする。
- 外部化する場合、Electron配布物に実行時依存が含まれることを確認する。
- RendererバンドルへMastraサーバーコードを含めない。
- Electron内蔵Node.jsで`.output/server/index.mjs`と`/api/ping`を起動確認する。

## 9. テスト要件

- 機能フラグの有効値・無効値を検証する。
- Mastraランタイムが遅延初期化され、同一プロセス内で再利用されることを検証する。
- 異なるモデルを連続指定した場合に、各リクエストが指定モデルを使用することを検証する。
- Request Contextのスパン表現にモデル内部のAPIキーが含まれないことを検証する。
- 機能フラグ無効時にMastraチャットサービスがモデルを呼び出さないことを検証する。
- GeminiとOpenAIの実接続テストは`npm run test:mastra:live`からだけ実行し、通常のVitestではスキップする。
- 実接続テストは`GEMINI_API_KEY`と`OPENAI_API_KEY`をテストプロセスから参照し、値をログ、エラー、スナップショットへ出力しない。
- Mastraテストには`.env`を探索しない専用Vitest設定を用い、環境変数は起動元からだけ受け取る。
- WebSocket経路切替、履歴・添付、既存チャット・音声イベント、切断時キャンセル、エラー文のマスキングを検証する。
- 実接続の既定モデルはGeminiを`gemini-3.5-flash-lite`、OpenAIを`gpt-4o-mini`とし、`MASTRA_TEST_GEMINI_MODEL`と`MASTRA_TEST_OPENAI_MODEL`で上書きできる。
- lint、型チェック、対象Vitest、本番ビルドを実行する。

## 10. ロールバック

- `MASTRA_CHAT_ENABLED`を未指定または`false`に戻すことでMastraチャット経路を無効化できること。
- 初期段階ではDBスキーマと既存履歴を変更しないこと。
- Legacyの`ChatAiService`とそのテストを削除・変更しないこと。
- Mastra専用コードを削除し、`@mastra/core`依存を戻せば導入前状態へ復元できること。
