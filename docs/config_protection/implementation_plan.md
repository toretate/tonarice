# 実装計画書: 設定ファイルのJSON分割保存と会話履歴のユーザー単位 SQLite 化

## 1. 背景と目的
マルチクライアント（Web / Electron）およびマルチユーザー（複数マスコットが参加するグループ会話など）を想定し、データの信頼性とポータビリティを高めるため、データ管理構成の根本的な見直しを行います。

これまでのDB一元化（または設定ファイル単一化）から、データサイズが小さく扱いがシンプルな設定系は **ユーザー別・マスコット別の個別 JSON ファイル** に分割してアトミック保存し、データサイズが大きく高成長する会話履歴は **ユーザー単位で独立した SQLite データベース** で管理する構成へと移行します。

---

## 2. 全体設計

### 2.1. 物理配置設計

```
app/storage/
├── config.db                                    # アプリ全体のグローバル共有データ (SQLite)
└── users/
    └── ${user_id}/                              # ユーザー個別ディレクトリ
        ├── user_config.json                     # ユーザーの環境設定 (JSON)
        ├── chat_histories.db                    # ユーザーの全対話履歴 (SQLite)
        └── mascots/
            └── ${mascot_id}/                    # マスコット個別ディレクトリ
                └── mascot_config.json           # アセット・音声・個別AI等の設定 (JSON)
```

### 2.2. 各ストレージの役割

* **ユーザー設定 (`user_config.json`)**:
  * テーマ、音量、連携APIキーなど、ユーザー環境設定のみを格納（マスコットデータは除外）。
  * サーバー側でも一時ファイル（`.tmp`）を経由したアトミック書き込みを行い、ファイル破損を防ぎます。
* **マスコット設定 (`mascots/${mascot_id}/mascot_config.json`)**:
  * マスコットごとの衣装アセットパス、表情・ポーズの座標スケール、個別キャラクタープロンプト等を格納。
  * マスコットの設定更新時は、該当マスコットのファイルのみを書き換えるため、他の設定ファイルを巻き込んで破損させるリスクがありません。
* **会話履歴DB (`chat_histories.db`)**:
  * ユーザーごとの SQLite データベースとし、将来の複数マスコット参加のグループ会話に対応できるよう、`chat_sessions`, `session_participants`, `messages` のテーブル構造で管理します。

---

## 3. 移行（マイグレーション）設計

サーバー起動時（または初回APIアクセス時）に、古いファイルベースの資産を新構成に自動インポートします。

### 3.1. 設定ファイル（config.json）のマイグレーション
1. 既存の `storage/users/${user_id}/config.json` を検出します。
2. JSONを読み込み、以下の2つに分割します。
   * `mascots` 配列を除外したシステム設定データを `user_config.json` に書き込みます。
   * `mascots` 配列内の各マスコットについて、対応するディレクトリ `mascots/${mascot_id}/` を掘り、その中に `mascot_config.json` として個別書き込みます。
3. インポート完了後、元の `config.json` は `config.json.imported` にリネームして退避します。

### 3.2. 会話履歴（chat_history.json）のマイグレーション
1. 既存の `storage/users/${user_id}/chat_history.json` を検出します。
2. `chat_histories.db`（SQLite）を作成し、テーブルを初期化します。
3. 読み込んだ JSON 履歴を解析し、セッション（個別チャットの場合はマスコットID等を基準にしたセッション）およびメッセージを `messages` テーブル等に流し込み（`INSERT`）ます。
4. インポート完了後、元の `chat_history.json` は `chat_history.json.imported` にリネームして退避します。

---

## 4. API 設計

### 4.1. ユーザー設定
* **GET `/api/config`**:
  * `user_config.json` をロードして返却。
* **POST `/api/config`**:
  * 送信されたシステム設定データを `user_config.json` にアトミック上書き保存。

### 4.2. マスコット設定
* **GET `/api/mascots`**:
  * `mascots/` 配下のサブフォルダを走査し、各フォルダの `mascot_config.json` をロードして一覧として返却。
* **POST `/api/mascots`**:
  * 新規マスコット追加時、該当のフォルダを作成し `mascot_config.json` を新規作成。
* **POST `/api/mascots/:id`**:
  * 指定マスコット ID の `mascot_config.json` のみをアトミック上書き保存。
* **DELETE `/api/mascots/:id`**:
  * 指定マスコットのフォルダ（設定およびアセット）を削除。

### 4.3. 会話履歴
* **GET `/api/history`**:
  * `chat_histories.db` から、指定されたセッション（またはマスコットID）に該当する会話ログをクエリして返却。
* **POST `/api/history`**:
  * `chat_histories.db` の `messages` テーブルに発言を追加。
