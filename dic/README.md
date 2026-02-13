# MeCab辞書ディレクトリ

このディレクトリにMeCabの辞書ファイルを配置してください。

## ⚠️ 重要: 自動ダウンロードは現在不安定です

MeCab辞書の自動ダウンロード機能は、GitHubやSourceForgeのURLが変更されているため、
現在正常に動作しません。**手動でのダウンロードと配置を強く推奨します。**

---

## 📥 手動ダウンロード手順（推奨）

### 方法1: MeCab本体をインストール（最も簡単）

1. **MeCab公式サイトからWindowsインストーラーをダウンロード**
   - https://taku910.github.io/mecab/
   - `mecab-0.996.exe` をダウンロード

2. **インストール実行**
   - 文字コードは `UTF-8` を選択
   - デフォルトの場所にインストール（通常 `C:\Program Files (x86)\MeCab\`）

3. **辞書ファイルをコピー**
   - インストールした `C:\Program Files (x86)\MeCab\dic\ipadic\` フォルダ内の全ファイルを
   - このディレクトリ（`dic\ipadic\`）にコピー

   必要なファイル:
   ```
   dic\ipadic\
   ├── char.bin
   ├── dicrc
   ├── matrix.bin
   ├── sys.dic
   ├── unk.dic
   └── その他の.dicファイル
   ```

### 方法2: SourceForgeから直接ダウンロード

1. **SourceForgeのMeCabプロジェクトページにアクセス**
   - https://sourceforge.net/projects/mecab/files/mecab-ipadic/

2. **最新版をダウンロード**
   - `mecab-ipadic-2.7.0-20070801.tar.gz` をダウンロード

3. **解凍**
   - 7-ZipやWinRARなどで `.tar.gz` を解凍
   - 解凍したフォルダ内の辞書ファイルを `dic\ipadic\` にコピー

---

## 推奨辞書

### 標準辞書 (IPAdic) ✅ 推奨
MeCab標準の辞書です。安定して動作します。

- **サイズ**: 約12MB
- **特徴**: 基本的な日本語の形態素解析に対応
- **用途**: 一般的な日本語テキストの読み仮名変換

### NEologd辞書 ⚠️ 高度な用途向け
最新の固有名詞や新語に対応した辞書ですが、セットアップが複雑です。

- **公式**: https://github.com/neologd/mecab-ipadic-neologd
- **注意**: Windows用のビルド済みバイナリは公式には提供されていません
- **サイズ**: 約600MB以上
- **セットアップ**: WSLやDockerでのビルドが必要

---

## 辞書の配置場所

アプリケーションは以下の順序で辞書を探索します：

1. `<実行ファイルのディレクトリ>/dic/ipadic/`
2. `<実行ファイルのディレクトリ>/dic/mecab-ipadic-neologd/`
3. `%APPDATA%/DesktopAiMascot/dic/ipadic/`
4. システムにインストールされたMeCabのデフォルト辞書

---

## 辞書が見つからない場合

辞書が見つからない場合、以下のフォールバック処理が実行されます：

1. MeCabのデフォルト辞書を使用（システムにMeCabがインストールされている場合）
2. 元のテキストをそのまま使用（読み仮名変換なし）

---

## トラブルシューティング

### MeCabが「辞書が見つかりません」エラーを出す

**原因**: 辞書ファイルが正しく配置されていない

**対処法**:
1. `dic\ipadic\` フォルダが存在するか確認
2. `sys.dic`, `matrix.bin`, `char.bin` などのファイルが存在するか確認
3. ファイルのアクセス権限を確認

### 文字化けが発生する

**原因**: 辞書の文字コードが異なる

**対処法**:
1. UTF-8版の辞書を使用
2. MeCabインストール時に文字コードを `UTF-8` に設定

### アプリが辞書を認識しない

**原因**: 辞書ファイルのパスが間違っている

**対処法**:
1. Voice AI設定画面で辞書の状態を確認
2. デバッグログで辞書の探索パスを確認
3. フォルダ名が正確か確認（`ipadic` または `mecab-ipadic-neologd`）

---

## 参考リンク

- **MeCab公式サイト**: https://taku910.github.io/mecab/
- **MeCab SourceForge**: https://sourceforge.net/projects/mecab/
- **NEologd辞書**: https://github.com/neologd/mecab-ipadic-neologd
- **MeCab.DotNet**: https://github.com/kekyo/MeCab.DotNet

---

## 注意事項

- 辞書ファイルは大きいため、Gitにはコミットしないでください
- `.gitignore`で除外されています
- 配布時は別途辞書ファイルをダウンロードするように案内してください
