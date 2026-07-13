# Gemini 向け修正指示 — タスク削除時の ID 誤指定

## 背景

ユーザーの「朝のタスクを全部削除しておいて」という依頼に対し、Gemini が次のようにタスク名を `id` に指定して削除し、失敗した。

```text
manageTasks({ action: 'search', query: '朝' })
manageTasks({ action: 'delete', id: 'Apps 朝会' })
Task with ID Apps 朝会 not found.
```

検索結果にタスク ID が含まれていなかったことが直接原因である。現在の作業差分では `ws.ts` のタスク・メモ検索結果に ID を表示し、LM Studio 用の per-tool prompt に ID の利用方法を追記している。

ただし、`ChatAiService` は Gemini / OpenAI を native function-calling モードとして扱い、per-tool prompt を system prompt に注入しない。そのため、`manageTasks.prompt.ts` と `manageMemos.prompt.ts` だけに指示を追加しても Gemini には届かない。

## 修正目的

Gemini が検索結果で返された一意な ID を `update` / `delete` の `id` 引数へ正確に渡し、タイトルやメモ本文を ID として使用しないようにする。あわせて、検索結果から ID が欠落する回帰をテストで防止する。

## 必須対応

### 1. Gemini が参照するツール定義へ ID 利用ルールを追加する

対象:

- `app/src/utils/task-tools-shared.ts`
- `app/src/utils/memo-tools-shared.ts`

cloud モデルはツールの `description` とパラメータの JSON スキーマを参照する。少なくとも `id` パラメータの `.describe(...)` に、次の制約が明確に伝わる文言を追加すること。

- `update` / `delete` の前に、対象 ID が不明なら `search` を実行する。
- `search` の結果に含まれる ID を、そのまま `id` に指定する。
- タスクのタイトルやメモ本文を `id` に指定しない。
- 複数件を操作する場合は、各検索結果の ID を使って対象ごとに操作する。

タスク ID やメモ ID の具体的な接頭辞だけに依存せず、「検索結果が返した ID を使用する」という意味を中心に記述すること。

`manageTasks.prompt.ts` / `manageMemos.prompt.ts` の追記は LM Studio の誘導として有効なので削除しないこと。ただし、cloud モデルにも prompt が注入されるよう `ChatAiService` の native-first 分岐を戻してはならない。

### 2. ID 付き検索結果を維持する

対象:

- `app/src/server/routes/ws.ts`

現在の差分にある次の出力を維持すること。

```text
- [ID: task_xxx] [未完了] Apps 朝会 (予定日時: ...)
- [ID: memo_xxx] メモ本文
```

ID は DB から取得した実際の `id` を出力し、タイトルや本文から生成・推測しないこと。

### 3. 回帰テストを追加する

最低限、次を自動テストで保証すること。

1. `manageTasks` の `search` 結果に実際の task ID が含まれる。
2. `manageMemos` の `search` 結果に実際の memo ID が含まれる。
3. 検索結果で得た task ID を `delete` に指定すると、その ID が削除処理へ渡る。
4. Gemini 用の Vercel tool 定義に、検索結果の ID を使う制約が含まれる。
5. Gemini の system prompt に per-tool prompt を注入しない既存仕様が維持される。

`ws.ts` が直接テストしにくい場合は、検索結果のフォーマット処理を小さな純粋関数としてサーバー側ユーティリティへ分離し、その関数をテストしてよい。1ファイルへ機能を詰め込まず、コメントを追加する場合は日本語にすること。

既存テスト内の ID なし検索結果モックも、今回の実際のレスポンス形式に合わせて更新すること。

## スコープ外

「朝のタスク」を「タイトルに『朝』を含むタスク」と解釈するか、「午前中に予定されたタスク」と解釈するかは別の検索仕様である。今回の修正では、ID の欠落と誤指定の解消を優先する。時間帯検索まで変更する場合は、既存の `query` / `date` の意味を暗黙に変えず、別途仕様とテストを提示すること。

## 禁止事項

- タイトルまたはメモ本文を ID として受け入れるフォールバックをサーバーに追加しない。
- ID 不一致時に曖昧検索して最初の1件を削除しない。
- Gemini 対応のために、cloud モデルへの per-tool prompt 注入を復活させない。
- 関係のない `.claude/settings.local.json` や他機能を変更しない。
- コミット、push を行わない。

## 検証コマンド

変更後、少なくとも以下を実行すること。

```powershell
cd app
npx vitest run src/server/__tests__/chat-ai-service.test.ts src/skills/tool-use/__tests__/tool-use.test.ts
npx vue-tsc --noEmit -p tsconfig.json --ignoreDeprecations 6
```

追加したテストファイルが上記の対象外なら、そのテストも明示的に実行すること。最後に `git diff --check` を実行すること。

## 完了条件

- Gemini が参照するツール定義に ID 利用ルールが存在する。
- 検索結果に DB 上の ID が含まれる。
- 検索結果の ID を用いた削除経路がテストで保証される。
- Gemini / OpenAI の native-first 方針と LM Studio の per-tool prompt 方針が維持される。
- 型チェックと対象テストが成功する。
- 実施内容、変更ファイル、テスト結果、未解決事項を日本語で報告する。
