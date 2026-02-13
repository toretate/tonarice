# MeCab読み仮名変換機能

## 概要

MeCab.DotNetとNEologd辞書を使用して、テキスト内の英単語やカタカナを高速に読み仮名に変換する機能です。

## 特徴

- **高速**: 音声合成ベースの方式と比較して大幅に高速
- **辞書ベース**: NEologd辞書により新語・固有名詞にも対応
- **フォールバック**: MeCabが利用できない場合は自動的に音声合成ベースの方式に切り替え

## アーキテクチャ

```
EnglishReadingConverter (ファサード)
├── MeCabReadingSkill (優先)
│   └── MeCab.DotNet + NEologd辞書
└── EnglishReadingSkill (フォールバック)
    └── Windows音声合成 + 音声認識
```

## 辞書のセットアップ

### 1. NEologd辞書のダウンロード

#### オプションA: Windows用ビルド済みバイナリ（推奨）

1. 以下のリポジトリからダウンロード:
   - https://github.com/neologd/mecab-ipadic-neologd/releases
   - または有志のWindows版ビルド

2. ダウンロードしたファイルを `dic/mecab-ipadic-neologd/` に配置

#### オプションB: WSLでビルド

```bash
# WSLを起動
wsl

# NEologdをクローン
git clone --depth 1 https://github.com/neologd/mecab-ipadic-neologd.git
cd mecab-ipadic-neologd

# ビルド
./bin/install-mecab-ipadic-neologd -n

# ビルドされた辞書をコピー
# 通常は /usr/local/lib/mecab/dic/mecab-ipadic-neologd/ にインストールされる
```

3. ビルドされた辞書ファイルをWindowsのプロジェクトディレクトリにコピー

```powershell
# PowerShellで実行
$wslPath = wsl wslpath -w /usr/local/lib/mecab/dic/mecab-ipadic-neologd
Copy-Item "$wslPath\*" -Destination ".\dic\mecab-ipadic-neologd\" -Recurse
```

### 2. ディレクトリ構造

```
DesktopAiMascot/
├── dic/
│   ├── README.md
│   └── mecab-ipadic-neologd/
│       ├── char.bin
│       ├── dicrc
│       ├── matrix.bin
│       ├── sys.dic
│       ├── unk.dic
│       └── ... (その他の辞書ファイル)
```

## 使用方法

### 基本的な使い方

```csharp
using DesktopAiMascot.aiservice.voice;

// 自動的に最適な方式で変換
var result = await EnglishReadingConverter.ConvertAsync("私はappleが好きです");
// 結果: "ワタシハアップルガスキデス" (MeCab使用時)
```

### 直接MeCabを使用

```csharp
using DesktopAiMascot.skills;

var skill = new MeCabReadingSkill();
skill.Initialize("dic/mecab-ipadic-neologd");

var result = await skill.ConvertToReadingAsync("東京タワー");
// 結果: "トウキョウタワー"

skill.Dispose();
```

## 辞書の探索順序

1. `<実行ファイルのディレクトリ>/dic/mecab-ipadic-neologd/`
2. `<実行ファイルのディレクトリ>/dic/ipadic/`
3. `%APPDATA%/DesktopAiMascot/dic/mecab-ipadic-neologd/`
4. デフォルト辞書（システムにMeCabがインストールされている場合）

## トラブルシューティング

### MeCabが初期化できない

**症状**: ログに「MeCabが初期化されていません」と表示される

**対処法**:
1. 辞書ファイルが正しく配置されているか確認
2. MeCab.DotNetパッケージが正しくインストールされているか確認
3. フォールバック処理により音声合成ベースの方式が使用されます

### 辞書ファイルが見つからない

**症状**: デフォルト辞書が使用される、または変換が遅い

**対処法**:
1. `dic/README.md` を参照して辞書を配置
2. ログで辞書の探索パスを確認
3. 辞書ディレクトリの権限を確認

## パフォーマンス比較

| 方式 | 処理時間 (目安) | メリット | デメリット |
|------|----------------|---------|-----------|
| MeCab | ~10ms | 高速、新語対応 | 辞書ファイルが必要 |
| 音声合成 | ~500ms-1s | 辞書不要 | 遅い、音声エンジンが必要 |

## 今後の拡張

- [ ] 辞書の自動ダウンロード機能
- [ ] カスタム辞書の追加サポート
- [ ] 読み仮名のキャッシュ機能
- [ ] `english_readings.json` の活用
