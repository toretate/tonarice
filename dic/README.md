# MeCab辞書ディレクトリ

このディレクトリにMeCabの辞書ファイルを配置してください。

## 推奨辞書

### mecab-ipadic-NEologd
最新の固有名詞や新語に対応した辞書です。

#### ダウンロード方法

1. **Windows用ビルド済みバイナリをダウンロード**
   - GitHub Release から入手: https://github.com/neologd/mecab-ipadic-neologd/releases
   - または、有志がビルドしたWindows版を探す

2. **自分でビルドする（WSL使用）**
   ```bash
   # WSLでLinux環境を起動
   git clone --depth 1 https://github.com/neologd/mecab-ipadic-neologd.git
   cd mecab-ipadic-neologd
   ./bin/install-mecab-ipadic-neologd -n
   ```

3. **ビルドされた辞書ファイルをコピー**
   ```
   dic/
   └── mecab-ipadic-neologd/
       ├── char.bin
       ├── dicrc
       ├── matrix.bin
       ├── sys.dic
       ├── unk.dic
       └── ... (その他の辞書ファイル)
   ```

### 標準辞書 (ipadic)
MeCab標準の辞書です。NEologdが利用できない場合のフォールバックとして使用できます。

```
dic/
└── ipadic/
    ├── char.bin
    ├── dicrc
    ├── matrix.bin
    ├── sys.dic
    ├── unk.dic
    └── ... (その他の辞書ファイル)
```

## 辞書の配置場所

アプリケーションは以下の順序で辞書を探索します：

1. `<実行ファイルのディレクトリ>/dic/mecab-ipadic-neologd/`
2. `<実行ファイルのディレクトリ>/dic/ipadic/`
3. `%APPDATA%/DesktopAiMascot/dic/mecab-ipadic-neologd/`

## 辞書が見つからない場合

辞書が見つからない場合、以下のフォールバック処理が実行されます：

1. MeCabのデフォルト辞書（システムにインストールされている場合）
2. 音声合成ベースの読み取得（時間がかかる）

## 注意事項

- 辞書ファイルは大きいため、Gitにはコミットしないでください
- `.gitignore`で除外されています
- 配布時は別途辞書ファイルをダウンロードするように案内してください
