# PR #75 レビュー結果

- **PR**: #75「対話チャットを Mastra へ移行」
- **ブランチ**: `codex/mastra-introduction-plan` → `master`
- **確認対象コミット**: `591d228c2a7d7f8405b450e96e96b5eb7be86f8c`
- **レビュー日**: 2026-11-22

---

## 総評

Mastra への対話チャット移行において、セキュリティ境界と安全側の設計が非常に丁寧に実装されています。

- **評価できる点**:
  - API キーや認証情報を共有ランタイム・`RequestContext`・トレース・エラー応答・通常ログへ露出させない分離設計（`model-resolver.ts`, `request-context.ts`, `chat-route.ts`, `tool-observation.ts`）。
  - 接続単位の操作承認（`tool-approval.ts`）と、永続的な試行記録による重複実行防止（`claimMutation`）、`launchApp` のホワイトリスト + `shell: false` 実行、`createMemoryIdentity` による SHA-256 スコープ分離。
  - Android 側の `UrlPolicy` / `WebViewNavigationPolicy`（Release での平文通信禁止、`allowFileAccess = false`、SSL エラー拒否、サードパーティ Cookie 拒否）。
  - `.env` を読まない専用 Vitest 設定（`vitest.mastra.config.ts`, `vitest.no-env.config.ts`）や実 API テスト隔離など、テスト基盤が充実。

一方で、**並列ツール呼び出し時の承認拒否**、**履歴読み込み失敗時のチャット操作不能**、**タイムアウト設計の競合**など、修正・確認が望ましい点があります。

---

## 要修正・重大な指摘

### 1. 並列ツール呼び出し時に 2 件目以降の操作確認が無言で自動拒否される
- **対象**: `app/src/components/chatpanel/useChatConnection.ts`（L278-L290）
- **内容**: `tool-approval-request` 受信時、すでに `pendingToolApproval.value` が設定されていると `else if (pendingToolApproval.value)` 分岐に入り、確認ダイアログを表示しないまま即座に `approved: false` を返送しています。
- **影響**: モデルが 1 ターンで複数の書き込み系ツール（例: タスクの複数登録・複数削除）を並列呼び出しした場合、1 件目だけ確認ダイアログが出て 2 件目以降が確認なしに自動拒否されます。
- **対応案**: 承認リクエストをキューで保持し、現在の確認が完了したら次のリクエストを表示するよう変更する。

### 2. `/api/mastra-history` の取得失敗で `window.alert` が出てチャットが操作不能になる
- **対象**:
  - `app/src/components/chatpanel/useChatHistory.ts`（L196-L216）
  - `app/src/components/chatpanel/useChatConnection.ts`（L486-L488）
- **内容**:
  - `loadHistory()` 内で `loadMemoryHistory(mascotId)` が失敗（未認証 401、サーバー停止、一時通信エラーなど）すると、`window.alert(...)` を呼び出したうえで `isHistoryLoaded.value = true` にせず早期 `return` します。
  - `sendMessage()` は `if (params.isHistoryLoaded && !params.isHistoryLoaded.value) return;` で送信をブロックするため、一度失敗するとチャット送信等が一切反応しなくなります。
  - テスト環境（happy-dom）でも `IntegratedLayout.test.ts` 実行時に `ChatPanel` マウント時の `loadHistory()` から `TypeError: window.alert is not a function` の **Unhandled Rejection が 7 件**発生しています。
- **対応案**: 画面内通知（非ブロッキング）やリトライ導線を用意し、エラー時でもテスト環境やフォールバック動作で破綻しないようにする。

### 3. ツール承認の待ち時間が生成全体の 60 秒タイムアウトに含まれている
- **対象**:
  - `app/src/server/mastra/mastra-chat-service.ts`（L78-L81）
  - `app/src/server/mastra/tool-approval.ts`（L23）
  - `app/src/components/chatpanel/useChatConnection.ts`（L289）
- **内容**: `MastraChatService.generateResponse` は全体のタイムアウトを 60 秒（`AbortSignal.timeout(60000)`）に設定していますが、クライアント側のダイアログ待機が 40 秒、サーバー側の承認待機が 45 秒あります。
- **影響**: ローカル LLM（LM Studio 等）の初回推論に 20〜30 秒かかった後、ユーザーが 35 秒ほど考えて「承認」を押すと、承認直後や最終応答生成中に合計 60 秒へ達してタイムアウト失敗します。
- **対応案**: 承認待ち時間中は生成タイムアウトを停止／延長するか、ステップ単位のタイムアウト管理に切り替える。

### 4. 仕様書間の記述矛盾（旧経路・機能フラグの扱い）
- **対象**:
  - `docs/specs/Application.spec.md`（L189-L195）
  - `docs/specs/MastraIntegration.spec.md`（L40）
- **内容**: `MastraIntegration.spec.md` および実装では旧チャット経路と `MASTRA_CHAT_ENABLED` フラグによる切り戻しを廃止していますが、`Application.spec.md` の「3. AIエージェント基盤」には「段階導入」「正式移行までは機能フラグで既存AI経路へ戻せる構成を維持する」という旧方針が残っています。
- **対応案**: `Application.spec.md` を最新の仕様に合わせて更新する。

---

## 中程度の指摘（設計・運用・エラーハンドリング）

### 5. Mastra Memory への添付データ保存・一括取得と、セッション状態の非永続化
- **対象**:
  - `app/src/server/mastra/chat-memory-turn.ts`（L28-L35）
  - `app/src/server/mastra/memory-history.ts`（L37, L52-L70）
  - `app/src/components/chatpanel/useChatHistory.ts`（L226-L256）
- **内容**:
  - Base64 の `data:` URL をそのまま `memory.db` に保存し、`GET /api/mastra-history` が全セッション・全メッセージの添付を一括で読み込んで返すため、画像添付が増えると起動時ロードの負荷・メモリ消費が線形に増加します。
  - `usesMastraHistory` が有効な間は `saveHistoryForMascot()` でファイル保存を行わないため、`activeSessionId`（どの会話を開いていたか）が再起動後に保持されません。また、初期挨拶（`id: 1`）は DB にないためリロード後に消え、タイトル生成も送信直後（15 文字＋`...`、本文空なら `""`）と DB 再読込後（30 文字または `'新しい話題'`）で差異が出ます。

### 6. LM Studio 周りのエラー通知・h3 エラー形式の不整合
- **対象**:
  - `app/src/server/mastra/chat-route.ts`（L6-L15）
  - `app/src/server/routes/ws.ts`（L348-L355）
  - `app/src/server/api/lmstudio/reload.post.ts`（L11, L21-L25）
  - `app/src/server/api/lmstudio/status.post.ts`（L8-L12）
  - `app/src/components/settings/ChatGenSettingsPanel.vue`（L137-L140）
- **内容**:
  - 旧 `ws.ts` にあったコンテキスト長超過（`context_length_exceeded` 等）の案内文が `getMastraChatErrorMessage()` に引き継がれておらず、一律で汎用エラーになります。コンテキストサイズ再ロード UI と連携しやすいよう専用メッセージを維持・復活させるのが望ましいです。
  - `reload.post.ts` / `status.post.ts` は `createError({ statusCode, statusMessage })` を使っており、テスト時に h3 から非推奨警告（`Please prefer using message for longer error messages instead of statusMessage`）が出力されています。クライアント側の `readLmStudioError` も `body?.statusMessage` のみ見ているため、`body?.message || body?.statusMessage` の両対応にして `message` 側へ揃える方が安全です。
  - `reload.post.ts` L11 の `URL.canParse` は Node 18.17+ 以降が必要で、`README.md` の「Node.js 18.0 以降」要件とわずかにずれます。

### 7. `/api/tts` の `getIrodoriLoras` アクションの入力検証・例外処理不足
- **対象**: `app/src/server/api/tts.post.ts`（L507-L527）
- **内容**: `endpoint` のプロトコル検証（`http:` / `https:` 制限等）がなく、`fetch` 失敗時に `clearTimeout(timeoutId)` が呼ばれないパスがあります。また Electron 側（`app/electron/ipc-handlers/irodori-handler.ts` L76-L112）のように `{ success: false, loras: [], error }` を返さず 500 例外へ落ちる点も揃えると堅牢です。

### 8. 変更スコープの大きさと最終依存構成でのビルド／実機未確認
- **内容**: PR 本文に記載がある通り、最終的な依存ライブラリ更新後の `npm run build` および配布版 Electron での起動確認（`MastraIntegration.spec.md` 第 8 節の `@mastra/libsql` 含む `.output/server/index.mjs` の動作確認）が未実施です。マージ前に配布ビルドでの動作確認を完了することを推奨します。

---

## 軽微・改善提案

- `app/src/components/chatpanel/useChatConnection.ts`（L544, L679）: `aiMessage.id` を `Math.max(Date.now() + 1, (userMessage?.id ?? 0) + 1)` にしておくと、時刻巻き戻り時でもサーバー側の `memoryAssistantMessageId <= memoryUserMessageId` 拒否を防げます。
- `app/src/server/mastra/chat-input.ts`（L29）: `options.enableThinking` 引数が関数内で未使用です。
- `android/app/src/main/java/jp/toretate/tonarice/MainActivity.kt`（L482）: WebView のファイル選択が `image/*` 固定のため、Android からはテキスト等のファイル添付は選択できません。MVP の意図された制限であれば `docs/specs/Android.md` に注記すると親切です。

---

## 手元での検証結果（チェック実行ログ）

`app/` ディレクトリにて検証を実施しました（コードは変更していません）。

- `npm run lint`: **成功**（437 files checked, error 0）
- `npm run typecheck`: **成功**（error 0）
- `npm run typecheck:electron`: **成功**（error 0）
- サーバー・Mastra・LM Studio・Electron ロガー単体テスト（`vitest.mastra.config.ts`、対象 29 ファイル）:
  - **28 ファイル成功（137 tests pass）、1 ファイルスキップ**（`src/server/mastra/__tests__/mastra-chat-service.live.test.ts` の実 API テスト 2 件）
- フロント／UI 関連テスト（`vitest.config.ts` で変更周辺 30 ファイルを抜粋実行）:
  - `src/components/chatpanel/__tests__/*`, `src/connector/__tests__/irodori-tts-connector.test.ts`, `src/utils/__tests__/*` は**すべて成功**。
  - `src/components/layouts/__tests__/IntegratedLayout.test.ts` はアサーション 7 件自体はパスしたものの、`window.alert is not a function` に起因する **Unhandled Rejection が 7 件**発生し、Vitest プロセスは終了コード 1 で終了しました。
  - PR 対象外の `src/store/__tests__/task.test.ts`（L245）で既存の失敗が 1 件確認されました（`categories.length` 期待値 1 に対し 2）。
