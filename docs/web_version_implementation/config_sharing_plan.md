# デスクトップ版とWeb版の設定共有（環境一元化）の実装計画

デスクトップ版（Electron）とWeb版（ブラウザ）で全く同じマスコットや設定データを共有し、同一の環境としてシームレスに利用できるようにするための実装計画です。

## 課題の原因
1. **設定ファイルの保存場所の不一致**:
   - デスクトップ版: OSのアプリデータフォルダ（`AppData/Roaming/desktop-ai-mascot/config.json`）
   - サーバ側: プロジェクトルートの `config.json`
   - Web版: ブラウザの `localStorage`
2. **Web版のローカル接続制限**:
   - Web版がブラウザで起動した際、初期設定で「サーバー連携（`useServer`）」が無効になっているため、ブラウザ単体の `localStorage`（空状態）を参照してしまい、デスクトップ側で登録したマスコットが表示されません。
3. **API認証の障壁**:
   - サーバーの `/api/config` エンドポイントがGoogleログイン認証（`authMiddleware`）を必須としているため、ローカル開発環境でログインしていないブラウザから設定を取得できません。

---

## 提案される変更点

### 1. デスクトップ版（Electron）の開発環境における設定パスの変更
#### [MODIFY] [app-config.ts](file:///c:/workspace/workspace-win/DesktopAiMascot/ui/electron/app-config.ts)
- デスクトップ版の開発時（`!app.isPackaged`）には、プロジェクトルートの `config.json` を直接読み書きするように変更します。パッケージングされた本番環境では従来どおり `userData` フォルダを使用します。
- これにより、Electronの開発環境とサーバーが**完全に同一の `config.json` を共有**します。

### 2. ローカル環境におけるサーバー認証のバイパス
#### [MODIFY] [auth-middleware.ts](file:///c:/workspace/workspace-win/DesktopAiMascot/server/src/middlewares/auth-middleware.ts)
- リクエストが `localhost`（`127.0.0.1` または `::1`）から送信されたローカル接続である場合、認証（トークン検証）をスキップして通過させるようにします。
- これにより、ローカルでのWeb版利用時にログイン不要で設定の読み書きができるようになります。（外部VPS等にホストした場合は、セキュリティのため従来どおり認証が強制されます）

### 3. Webポリフィルでのサーバー設定優先読み込み
#### [MODIFY] [browser-polyfill.ts](file:///c:/workspace/workspace-win/DesktopAiMascot/ui/src/utils/browser-polyfill.ts)
- ブラウザ環境下の `getAppConfig` および `updateAppConfig` 実行時、まずサーバー（`http://localhost:3000/api/config`）へのフェッチを試みます。
- サーバーとの通信に成功した場合はサーバーの設定値（＝共有の `config.json`）を使用し、サーバーが起動していない場合のみ `localStorage` にフォールバックします。

---

## 検証計画
1. `npm run dev:web` および `npm run server:dev` を起動。
2. デスクトップ版（`npm run dev`）で追加・編集したマスコットが、ブラウザ上のWeb版（`http://localhost:5173`）にも即座に自動反映されることを確認。
3. ブラウザ側での設定変更がデスクトップ版や `config.json` に同期されることを確認。
