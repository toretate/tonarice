# サーバー側データ管理仕様書 (Data Storage Specification)

マルチクライアント（Web / Electron）およびマルチユーザー（複数マスコット参加のグループ会話など）を想定した、サーバー側のデータ永続化設計仕様書です。

---

## 1. 物理配置・データ構造一覧

データ特性（更新頻度、成長率、ポータビリティ）に合わせて、保存先およびフォーマット（JSON / SQLite）を分離します。

```
app/storage/
├── config.db                                    # アプリケーション全体の共有データ (SQLite)
├── mastra/
│   └── memory.db                                # 通常チャットの会話履歴 (libSQL)
└── users/
    └── ${user_id}/                              # ユーザー個別ディレクトリ
        ├── user_config.json                     # ユーザーの環境設定（マスコットアセットを除く） (JSON)
        └── mascots/
            └── ${mascot_id}/                    # マスコット個別ディレクトリ
                └── mascot_config.json           # 表情・衣装・アセット座標等の設定 (JSON)
```

---

## 2. 各データの詳細設計

### 2.1. アプリケーション全体設定: `config.db` (SQLite)
システム全体の共通データ（登録ユーザーリスト、運用ステータス、グローバルログ等）を格納します。
* ※データが極めて軽量な場合は、将来的に `config.json` への変更も検討可能です。

### 2.2. ユーザー設定: `user_config.json` (JSON)
ユーザーの環境設定（テーマ、音量、選択中マスコットID、各種AIサービスのAPIキーなど）を格納します。
* **特徴**: データ量が非常に小さく、クライアント側でオブジェクトとしてそのままロード・保存（アトミック書き込み）を行うのに適しています。
* **保存項目例**:
  ```json
  {
      "theme": "dark",
      "volume": 80,
      "activeMascotId": "mascot_1",
      "googleAiStudioApiKey": "AIzaSy...",
      "chatOpacity": 1.0,
      "chatAlwaysOnTop": "sync"
  }
  ```

### 2.3. マスコット設定: `mascot_config.json` (JSON)
マスコットごとのアセット定義（表情や衣装の画像パス、オフセット座標、スケール）や、そのマスコット独自のAIプロンプト、音声設定などを格納します。
* **物理パス**: `app/storage/users/${user_id}/mascots/${mascot_id}/mascot_config.json`
* **特徴**: 表情の作成や衣装変更時に、このファイルのみを対象にアトミックな保存（一時ファイルを経由した置換）が行われるため、他の設定ファイルを巻き込んで破損させるリスクがありません。

### 2.4. 会話履歴データ

通常チャットの履歴は、ストレージルートの `mastra/memory.db` に Mastra Memory が保存します。Web・Electron・Android は認証付きの `/api/mastra-history` で履歴を取得・削除します。保存条件と会話の分離は [Mastra 統合仕様](MastraIntegration.spec.md) を参照してください。

## 3. 旧会話履歴の取り扱い

アップデート時、以下のデータは元の場所に残ります。アプリは旧データの読み込み、書き込み、削除、名前変更、Mastra Memory への自動取り込みを行いません。

- ストレージの `users/<userId>/` 以下にある `chat_histories.db` と SQLite の付随ファイル
- ユーザーディレクトリや旧開発環境の作業ディレクトリ、Electron のユーザーデータディレクトリにある `chat_history.json` と移行済みの `chat_history.json.imported` 系ファイル
- ブラウザーの localStorage にある旧履歴キー `desktop_ai_mascot_chat_history`

旧履歴を保管する場合は、各保存先から必要なデータをバックアップしてください。
