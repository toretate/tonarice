# OpenAI画像生成連携仕様書

## 1. 概要

画像生成AIの連携先として OpenAI Images API を提供する。画像生成エンジンに `openai_image` を選択した場合、テキストからの画像生成（t2i）と、添付画像を入力にした画像編集（i2i）を利用できる。

ChatGPTのサブスクリプション認証は使用せず、「API KEY設定」に保存された OpenAI Platform のAPIキーを使用する。

## 2. 設定

| 設定名 | 設定キー | 初期値 |
| --- | --- | --- |
| モデル | `openaiImageModel` | `gpt-image-2` |
| 品質 | `openaiImageQuality` | `auto` |
| サイズ | `openaiImageSize` | `1024x1024` |
| 背景 | `openaiImageBackground` | `auto` |

従来の `dalle3` 設定値は、ロード時に `openai_image` へ移行する。

## 3. 通信仕様

### 3.1 t2i

- エンドポイント: `POST https://api.openai.com/v1/images/generations`
- Content-Type: `application/json`
- 出力形式: PNG（Base64）

### 3.2 i2i

- エンドポイント: `POST https://api.openai.com/v1/images/edits`
- Content-Type: `multipart/form-data`
- 添付された Data URL を画像ファイルに変換し、`image[]` として送信する。
- 出力形式: PNG（Base64）

## 4. セキュリティ

- Electronでは、レンダラーからAPIキーをIPC引数として送らない。
- Electronメインプロセスが永続設定からAPIキーを取得する。
- Web実行時は、認証済みユーザーのサーバー設定からAPIキーを取得する。
- 通信ログにはAPIキーと画像のBase64データを出力しない。

## 5. エラー処理

- APIキー未設定時は、設定不足を示す日本語メッセージを返す。
- OpenAIから返されたエラーメッセージは「OpenAIとの接続エラー」にまとめて表示する。
- 応答に画像が含まれない場合は生成失敗として扱う。

## 6. Forgeとの切り替え

チャットの生成処理は `selectedImageEngine` を確認し、`openai_image` の場合はOpenAI、`sd_forge` の場合は既存のForgeコネクターへ振り分ける。Forge固有のLoRA、ネガティブプロンプト、ステップ数などはOpenAIへ送信しない。
