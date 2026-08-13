# tonarice Android WebView 版

このディレクトリは、既存の tonarice Web 版を Android WebView で表示する薄いネイティブシェルです。画面と業務ロジックは Web サーバー側の実装を利用し、Android 側では接続先設定、QR 読み取り、接続先履歴、WebView の安全な設定、戻る操作、外部リンク、ファイル選択、接続エラー表示を担当します。

## 開発環境

- Android Studio の安定版
- JDK 17
- Android SDK Platform 35
- Android SDK Build-Tools 35.x
- Android Emulator または Android 実機

Android Studio でこの `android/` ディレクトリを開き、Gradle の同期を完了してください。現時点ではリポジトリに Gradle Wrapper のバイナリを同梱していないため、Android Studio に付属する Gradle またはローカルの Gradle を使用します。

## Debug APK のビルド

```powershell
cd android
gradle assembleDebug
```

生成物は `app/build/outputs/apk/debug/app-debug.apk` です。Android Studio の Run からエミュレーターまたは USB デバッグを有効にした実機へインストールすることもできます。

## 接続先

初回起動時に、tonarice Web サーバーの URL を入力するか、接続先設定画面の **QRコードを読み取る** を選択します。`npm run dev:remote` で Nuxt を起動すると、Nuxt 標準の開発サーバー表示（listhen）に接続用 QR コードが表示されます。AQUOS のカメラでその QR コードを読み取ると URL が設定されます。

QR コードに表示された URL が端末から到達できない場合は、同じ起動ログの `Network` に表示される LAN 側の URL を手入力してください。PC と実機を同じ LAN に接続し、Windows ファイアウォールで開発サーバーのポート 3000 が許可されている必要があります。

手入力の例:

- Android エミュレーターからホスト PC: `http://10.0.2.2:3000`
- 同一 LAN の実機から開発サーバー: `http://192.168.x.x:3000`
- HTTPS で公開した Web サーバー: `https://example.example/`

URL は Android アプリの設定ストレージへ保存され、次回起動時に再利用されます。接続に成功した URL は新しい順の履歴として既定で 5 件まで保持され、設定画面から選択できます。API キーや認証情報を URL に埋め込まないでください。

履歴の上限はビルド時の環境変数 `TONARICE_ENDPOINT_HISTORY_LIMIT` で変更できます。1〜50 の整数だけが有効で、未指定または不正値の場合は 5 件です。Android Studio を起動する前に設定してください。

```powershell
$env:TONARICE_ENDPOINT_HISTORY_LIMIT = "5"
```

## 通信とセキュリティ

- Release ビルドは平文 HTTP を拒否します。
- Debug ビルドでは開発サーバー検証のため平文 HTTP を許可しています。配布用途には使用しないでください。
- WebView 内に表示できるのは設定した tonarice URL と同一オリジンのページだけです。
- 外部 HTTPS ページは端末の既定ブラウザで開きます。
- SSL/TLS 証明書エラーは無視せず、WebView の読み込みを中止します。
- WebView のデバッグは Debug ビルドだけで有効です。

## 既知の制約

- Web アセットは APK に同梱しないため、サーバーへ接続できない場合は画面を表示できません。
- Electron のウィンドウ操作、システムトレイ、バックグラウンド常駐機能は Android 版の対象外です。
- Android System WebView のバージョンにより、WebGL、音声、ファイル選択の挙動が変わる場合があります。
- QR 読み取りはカメラ権限を必要とします。権限を拒否した場合は URL を手入力できます。
