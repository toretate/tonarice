# Gemini画像生成連携仕様書

## 1. 概要

画像生成AIの連携先としてGemini APIのNano Bananaシリーズを提供する。チャットからテキスト画像生成（t2i）と、添付画像を入力にした画像編集（i2i）を利用できる。

## 2. 対応モデル

| 表示名 | モデルID | 用途 |
| --- | --- | --- |
| Nano Banana | `gemini-2.5-flash-image` | 従来版。1K固定 |
| Nano Banana 2 | `gemini-3.1-flash-image` | 推奨。速度と品質のバランスを重視 |
| Nano Banana Pro | `gemini-3-pro-image` | 複雑な指示と高品質制作向け |

## 3. 設定

- モデル
- 縦横比: `1:1`、`3:4`、`9:16`、`4:3`、`16:9`
- 解像度: `1K`、`2K`、`4K`

Nano Bananaは1K固定とし、解像度をAPIへ送信しない。Nano Banana 2とNano Banana Proは指定された解像度を使用する。

## 4. 通信仕様

- エンドポイント: `POST https://generativelanguage.googleapis.com/v1/models/{model}:generateContent`
- 認証: 「API KEY設定」のGoogle AI Studio APIキーを`x-goog-api-key`ヘッダーへ設定
- t2i: プロンプトをテキストpartとして送信
- i2i: プロンプトに加えて添付画像を`inline_data`として送信
- 応答: `inlineData.data`のBase64画像をチャットへ表示

APIキーと画像のBase64データは通信ログへ出力しない。
