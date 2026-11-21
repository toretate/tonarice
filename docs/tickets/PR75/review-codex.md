# PR #75 Codexレビュー

- 対象PR: https://github.com/toretate/tonarice/pull/75
- タイトル: 対話チャットを Mastra へ移行
- 対象コミット: `591d228c2a7d7f8405b450e96e96b5eb7be86f8c`
- 比較先: `master`（`37bddff41d19ac6ef84b2faed67e1ca1ed764b17`）
- レビュー日: 2026-11-22
- 主な確認範囲: チャット移行、履歴の保存・削除、ツール承認、切断・タイムアウト時の処理

## 指摘事項

### 1. [P2] 生成タイムアウトが変更操作の承認処理へ伝わらない

対象: `app/src/server/mastra/mastra-chat-service.ts:78`、`app/src/server/routes/ws.ts` の `authorizeSideEffect`

60秒のタイムアウトを組み合わせた Signal は Agent に渡されますが、ツール承認と変更操作の実行可否は接続切断用の `mastraController.signal` を参照しています。

例えば、生成開始から時間が経ってからツール承認を要求し、生成の60秒タイムアウト後、承認要求自体の期限内に承認すると、変更操作が実行され得ます。追加テストでは、生成用 Signal を中断した後も、承認待ちに相当する処理を解放すると変更処理が実行されることを確認しました。

また、この中断時に Agent が空の応答を返すと、`generateResponse` は代替文を正常応答として返します。WebSocket側では接続用 Signal が中断されていないため、その代替文が履歴へ保存されます。

生成タイムアウトを承認待ち・変更処理まで共有し、生成から戻った際にも中断状態を確認して、中断をエラーとして扱う必要があります。

### 2. [P2] 並行した承認要求の2件目以降が自動拒否される

対象: `app/src/components/chatpanel/useChatConnection.ts:280`

承認ダイアログが表示されている間に別の承認要求が届くと、`pendingToolApproval.value` が存在するため、後続要求へ利用者の判断なしで `approved: false` を返します。

例えば「AとBをメモして」に対してモデルが異なる2件のツール呼び出しを並行して返すと、最初の操作だけが確認画面に表示され、後続の操作は自動拒否されます。さらに、同一発話の変更は承認前に `executedMutations` へ登録されるため、モデルが同じ操作を再試行しても、その発話内では実行できません。

追加テストでも、異なる内容の承認要求を続けて受信すると、2件目に拒否応答を返すことを確認しました。承認要求をキューに入れて順番に確認するか、ツールの実行を直列化する必要があります。

### 3. [P2] 応答待ちでマスコットを切り替えると元の会話が更新されない

対象: `app/src/components/chatpanel/useChatHistory.ts:514`、`app/src/components/chatpanel/useChatConnection.ts` の `updatePendingMascotMessage` と `completePendingMessage`

応答待ちのマスコットAからBへ切り替えると、応答処理は現在表示中の `messages.value` だけを検索します。Aの応答バブルとユーザーメッセージが見つからず、Aのキャッシュには「考え中…」「送信中」が残ります。

その後Aへ戻っても、`loadedMemoryMascots` に登録済みであるため履歴を再取得せず、キャッシュを表示します。サーバーに応答が保存されていても、その表示へ反映されません。

追加テストで、AからBへ切り替えてAへ戻ってもAの履歴を再取得せず、応答待ちのキャッシュが残ることを確認しました。応答先を送信元のマスコット・会話にひも付けて更新するか、再表示時に履歴を再取得する必要があります。

## 検証結果

次の既存対象テストを実行しました。

```powershell
cd app
npx vitest run --config vitest.mastra.config.ts src/server/mastra src/server/__tests__/mastra-websocket.test.ts src/components/chatpanel/__tests__/useChatHistory.test.ts src/components/chatpanel/__tests__/useChatConnection.test.ts
```

- 16ファイル成功、1ファイルスキップ。
- 91件成功、実APIテスト2件スキップ。
- 追加の一時テスト4件も成功。タイムアウト後の処理継続、並行承認の自動拒否、履歴キャッシュの再利用、通常のモデル例外の伝播を確認しました。
- 一時テストは検証後に削除済みです。
- `git diff --check` は成功しました。
- lint、型チェック、本番ビルド、配布版・Android実機の動作確認は、このレビューでは実施していません。

このレビューでは実装修正、コミット、プッシュ、GitHubへのレビュー投稿は行っていません。
