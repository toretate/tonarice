# Android WebView 版仕様書

## 1. 目的と範囲

既存の tonarice スマートフォン Web 版を Android アプリとして配布する。Android 側は WebView を中心とした薄いネイティブシェルとし、画面、チャット、マスコット表示、設定、サーバー API 連携は Web 版を継続して利用する。

本仕様書の対象は `android/` の Android アプリである。Electron のデスクトップウィンドウ、システムトレイ、他アプリ上へのオーバーレイは対象外とする。

## 2. アーキテクチャ

```text
┌──────────────────────────────────────────┐
│ Android アプリ（Kotlin / AndroidX WebKit） │
│                                          │
│  接続先設定  QR読取  履歴  WebView  OS連携  │
└───────────────────┬──────────────────────┘
                    │ HTTPS（Debug は開発用 HTTP 可）
                    ▼
┌──────────────────────────────────────────┐
│ tonarice Web 版（Nuxt / Vue / Nitro）     │
│                                          │
│  UI、チャット、マスコット、WebSocket、API │
└──────────────────────────────────────────┘
```

### 2.1. Android 側の責務

- `android/` に独立した Gradle プロジェクトを配置する。
- Kotlin の単一 Activity で WebView を表示する。
- 初回起動時に Web サーバー URL を入力させ、設定ストレージへ保存する。
- 接続先設定画面からカメラを起動し、Nuxt 開発サーバーが表示する接続用 QR コードを読み取る。
- 接続に成功した URL を新しい順に履歴保存し、上限件数まで設定画面から再選択できるようにする。
- WebView の JavaScript、DOM Storage、Cookie、WebSocket、ユーザー操作による音声再生を有効にする。
- 同一オリジンの画面は WebView 内で遷移する。
- 外部 HTTP(S) URL は端末の既定ブラウザへ渡す。
- 戻る操作は WebView の履歴を優先し、履歴がない場合は接続先設定画面、またはアプリ終了へ進む。
- システムバーの Insets をルートへ適用し、ネイティブのツールバーと WebView がステータスバー・ナビゲーションバーに重ならないようにする。
- 接続中、接続失敗、HTTP エラー、TLS エラーの状態を表示し、再試行できるようにする。
- Web の画像選択要求を Android のシステムファイル選択へ渡す。

### 2.2. Web 版との境界

- WebView と Web 版の間に独自 JavaScript ブリッジを追加しない。
- Electron の `window.electronAPI` に依存する機能は、Web 版の `browser-polyfill.ts` が提供する範囲で動作させる。
- ネイティブ API が必要になった場合は、機能ごとの別 Issue でブリッジの権限、データ形式、テストを定義する。
- Web アセットは APK に同梱せず、保存済みの URL から取得する。サーバー側の更新は次回ページ読み込みで反映される。

## 3. 接続先設定

### 3.1. 入力と保存

- 許可するスキームは `http` と `https` のみとする。
- ホスト名を必須とし、ユーザー情報（ユーザー名、パスワード）を含む URL は拒否する。
- ポートは未指定、または 0〜65535 の範囲とする。
- URL は Android のアプリ内設定ストレージへ保存する。
- API キー、Cookie、Authorization ヘッダーなどの秘密情報を URL に埋め込まない。
- 保存先の消去と接続先の変更を設定画面から実行できるようにする。
- QR コードの内容は URL として同じ検証処理へ通し、`http` / `https` 以外やホストなしの値は拒否する。
- 接続先履歴は新しい順に重複排除して保持する。既定の上限は 5 件とし、ビルド時環境変数 `TONARICE_ENDPOINT_HISTORY_LIMIT` で 1〜50 件へ変更できる。不正値や未指定は 5 件へ戻す。

### 3.2. 開発と本番

- Debug ビルドでは、LAN 内の開発サーバーを検証するため平文 HTTP を許可する。
- Release ビルドでは Network Security Configuration の `base-config` で平文通信を拒否する。
- 本番接続は HTTPS を使用する。VPN、リバースプロキシ、証明書発行などの外部公開方法は本仕様の範囲外とする。

## 4. WebView 設定

### 4.1. 有効にする機能

- JavaScript
- DOM Storage
- Cookie
- WebSocket に必要な通常のネットワーク通信
- ユーザー操作を起点とした音声再生。チャット応答のTTSはWebSocketで文ごとに届くため、初回操作後の非同期な連続再生も許可する。
- 画像のシステムファイル選択

### 4.2. 無効にする機能

- `file://` のファイルアクセス
- `content://` を WebView が任意に直接読み込む機能
- `allowFileAccessFromFileURLs`
- `allowUniversalAccessFromFileURLs`
- 混在コンテンツ（HTTPS ページからの HTTP リソース）
- 複数ウィンドウ
- WebView 内のカメラ・マイクなどの権限（QR 読み取りは独立したネイティブ画面で必要時だけカメラを使用する）

WebView デバッグは Debug ビルドだけで有効にし、Release ビルドでは無効にする。

## 5. ナビゲーションポリシー

### 5.1. オリジン判定

接続先 URL の `scheme`、`host`、有効ポート（HTTP は 80、HTTPS は 443）を構造的に比較する。文字列の前方一致では判定しない。

### 5.2. 主フレーム

- 接続先と同一オリジンの HTTP(S) URL: WebView 内で読み込む。
- 外部の HTTP(S) URL: `ACTION_VIEW` で端末ブラウザへ渡す。
- `file`、`content`、`intent`、任意のカスタムスキーム: 拒否する。

### 5.3. サブリソース

画像、音声、フォント、API、WebSocket などのサブリソースは WebView の通常処理に任せる。ただし混在コンテンツは許可しない。

## 6. エラーとライフサイクル

- 初回 URL が未設定の場合は接続先設定画面を表示する。
- メインフレームのネットワークエラー、HTTP 4xx/5xx、TLS 証明書エラーでは、WebView の上にエラー表示を重ねる。
- TLS エラーでは `SslErrorHandler.proceed()` を呼び出さず、必ず読み込みを中止する。
- 再試行では保存済み URL を再読み込みする。
- 画面回転、バックグラウンド復帰、プロセス再生成時に接続先と WebView の履歴を可能な範囲で復元する。
- アプリがバックグラウンドにいる間の常時 WebSocket 接続や音声再生は保証しない。復帰時の再読み込み・再接続は別途検証する。

## 7. Android 版で利用できない機能

- Electron の透過ウィンドウ、分離ウィンドウ、クリック透過、ウィンドウドラッグ
- システムトレイとデスクトップ常駐
- ローカルファイルシステムへ直接書き込む Electron IPC
- デスクトップ版の定期タスク、通知、バックグラウンド常駐
- APK だけで完結するオフライン動作

利用できない機能は、Web 版または設定画面で明示的なエラー・非対応表示を行う。

## 8. テスト方針

### 8.1. JVM 単体テスト

- URL の正規化と不正スキーム、ユーザー情報、不正ポートの拒否
- 同一オリジン判定（大文字小文字、既定ポート、外部ホスト）
- 主フレームの WebView、外部ブラウザ、拒否の遷移判定

### 8.2. Instrumentation テスト

- 初回 URL 入力、保存、再起動後の復元、消去
- QR コード読み取り、URL 検証、接続先履歴の選択
- WebView の同一オリジン遷移、戻る操作、外部リンク
- 接続失敗、再試行、HTTP エラー表示
- 画像ファイル選択、縦横回転、ソフトウェアキーボード

### 8.3. 実機確認

- Android エミュレーターと実機で、HTTPS と LAN 内 HTTP を確認する。
- Android System WebView の更新状態を確認する。
- WebGL、チャット WebSocket、音声再生、マスコット画像表示を確認する。
- 実機でカメラ権限、Nuxt 起動時 QR コードの読み取り、読み取った URL への接続を確認する。

## 9. ビルド

必要環境は Android Studio、JDK 17、Android SDK Platform 35、Android SDK Build-Tools 35.x とする。

```powershell
cd android
gradle assembleDebug
```

Debug APK は `android/app/build/outputs/apk/debug/app-debug.apk` に生成される。Release 署名鍵と Google Play への公開は別タスクとする。

## 10. 関連資料

- GitHub Issue #36: 別マシン（スマホ:Android）からの利用
- GitHub Issue #49: スマートフォン Web 版への対応
- GitHub Issue #67: Android WebView 版アプリ（ガワネイティブ）を開発する
- `docs/tickets/smart-phone-issue.md`
- `android/README.md`
- [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview)
- [Network Security Configuration](https://developer.android.com/privacy-and-security/security-config)
- [Unsafe URI loading](https://developer.android.com/privacy-and-security/risks/unsafe-uri-loading)
