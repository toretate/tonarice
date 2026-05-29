using Godot;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using DesktopAiMascot.mascots;
using DesktopAiMascot.utils;
using Button = Godot.Button;

namespace DesktopAiMascot.ui.mascot_edit
{
    /// <summary>
    /// マスコット編集ウィンドウ
    /// </summary>
    public partial class MascotEditWindow : Window
    {
        private MascotModel _mascotModel = null!;
        private string _mascotDirectory = string.Empty;
        private List<MascotImageSet> _imageItems = new List<MascotImageSet>();

        private TextureRect _coverTextureRect = null!;
        private ItemList _imageList = null!;
        private MascotEditSettingControl _settingControl = null!;
        private Button _addImageButton = null!;
        private Button _saveButton = null!;
        private Button _cancelButton = null!;

        public override void _Ready()
        {
            Debug.WriteLine("[MascotEditWindow] _Ready() 開始");
            
            try
            {
                // ノードツリーをダンプ
                Debug.WriteLine("[MascotEditWindow] ========== ノードツリーダンプ開始 ==========");
                PrintNodeTree(this, 0);
                Debug.WriteLine("[MascotEditWindow] ========== ノードツリーダンプ終了 ==========");
                
                _coverTextureRect = GetNode<TextureRect>("%CoverTextureRect");
                Debug.WriteLine($"[MascotEditWindow] _coverTextureRect: {(_coverTextureRect != null ? "OK" : "NULL")}");
                
                _imageList = GetNode<ItemList>("%ImageList");
                Debug.WriteLine($"[MascotEditWindow] _imageList: {(_imageList != null ? "OK" : "NULL")}");
                
                // 通常のパスで取得を試みる
                var settingControlPath = "MarginContainer/VBoxContainer/MainPanel/HBoxContainer/RightPanel/SettingControl";
                Debug.WriteLine($"[MascotEditWindow] SettingControl取得を試みます: {settingControlPath}");
                
                var settingControlNode = GetNodeOrNull(settingControlPath);
                Debug.WriteLine($"[MascotEditWindow] settingControlNode (通常パス): {settingControlNode?.GetType().Name ?? "NULL"}");
                
                if (settingControlNode != null)
                {
                    _settingControl = settingControlNode as MascotEditSettingControl;
                    Debug.WriteLine($"[MascotEditWindow] キャスト結果: {(_settingControl != null ? "OK" : "FAILED")}");
                    
                    if (_settingControl == null)
                    {
                        Debug.WriteLine($"[MascotEditWindow] 実際の型: {settingControlNode.GetType().FullName}");
                    }
                }
                
                // unique_name_in_ownerでも試す
                if (_settingControl == null)
                {
                    Debug.WriteLine("[MascotEditWindow] unique_name_in_ownerで再取得を試みます");
                    var uniqueNode = GetNodeOrNull("%SettingControl");
                    Debug.WriteLine($"[MascotEditWindow] uniqueNode: {uniqueNode?.GetType().Name ?? "NULL"}");
                    
                    if (uniqueNode != null)
                    {
                        _settingControl = uniqueNode as MascotEditSettingControl;
                        Debug.WriteLine($"[MascotEditWindow] unique経由のキャスト: {(_settingControl != null ? "OK" : "FAILED")}");
                    }
                }
                
                // 手動インスタンス化を試みる
                if (_settingControl == null)
                {
                    Debug.WriteLine("[MascotEditWindow] 手動インスタンス化を試みます");
                    try
                    {
                        var settingControlScene = GD.Load<PackedScene>("res://ui/mascot_edit/MascotEditSettingControl.tscn");
                        if (settingControlScene != null)
                        {
                            Debug.WriteLine("[MascotEditWindow] シーンのロードに成功");
                            _settingControl = settingControlScene.Instantiate<MascotEditSettingControl>();
                            Debug.WriteLine($"[MascotEditWindow] インスタンス化結果: {(_settingControl != null ? "OK" : "NULL")}");
                            
                            if (_settingControl != null)
                            {
                                // RightPanelに追加
                                var rightPanel = GetNode<MarginContainer>("MarginContainer/VBoxContainer/MainPanel/HBoxContainer/RightPanel");
                                if (rightPanel != null)
                                {
                                    rightPanel.AddChild(_settingControl);
                                    _settingControl.Name = "SettingControl";
                                    Debug.WriteLine("[MascotEditWindow] RightPanelに追加しました");
                                }
                                else
                                {
                                    Debug.WriteLine("[MascotEditWindow] エラー: RightPanelが見つかりません");
                                }
                            }
                        }
                        else
                        {
                            Debug.WriteLine("[MascotEditWindow] エラー: シーンのロードに失敗");
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[MascotEditWindow] 手動インスタンス化エラー: {ex.Message}");
                    }
                }
                
                Debug.WriteLine($"[MascotEditWindow] _settingControl 最終結果: {(_settingControl != null ? "OK" : "NULL")}");
                
                _saveButton = GetNode<Button>("%SaveButton");
                Debug.WriteLine($"[MascotEditWindow] _saveButton: {(_saveButton != null ? "OK" : "NULL")}");
                
                _cancelButton = GetNode<Button>("%CancelButton");
                Debug.WriteLine($"[MascotEditWindow] _cancelButton: {(_cancelButton != null ? "OK" : "NULL")}");

                _addImageButton = GetNode<Button>("%AddImageButton");
                Debug.WriteLine($"[MascotEditWindow] _addImageButton: {(_addImageButton != null ? "OK" : "NULL")}");
 
                Debug.WriteLine("[MascotEditWindow] ノード取得完了");
 
                if (_imageList != null)
                    _imageList.ItemSelected += OnImageSelected;
                if (_addImageButton != null)
                    _addImageButton.Pressed += OnAddImageButtonPressed;
                if (_saveButton != null)
                    _saveButton.Pressed += OnSaveButtonPressed;
                if (_cancelButton != null)
                    _cancelButton.Pressed += OnCancelButtonPressed;

                CloseRequested += () => QueueFree();
                
                Debug.WriteLine("[MascotEditWindow] _Ready() 完了");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] _Ready() エラー: {ex.Message}");
                Debug.WriteLine($"[MascotEditWindow] スタックトレース: {ex.StackTrace}");
                GD.PrintErr($"_Ready() エラー: {ex.Message}");
            }
        }

        private void PrintNodeTree(Node node, int depth)
        {
            string indent = new string(' ', depth * 2);
            Debug.WriteLine($"{indent}- {node.Name} ({node.GetType().Name})");
            
            for (int i = 0; i < node.GetChildCount(); i++)
            {
                PrintNodeTree(node.GetChild(i), depth + 1);
            }
        }

        /// <summary>
        /// MascotModelを設定して初期化
        /// </summary>
        public void Initialize(MascotModel mascotModel)
        {
            Debug.WriteLine("[MascotEditWindow] Initialize() 開始");
            
            _mascotModel = mascotModel;
            _mascotDirectory = _mascotModel.DirectoryPath;

            Debug.WriteLine($"[MascotEditWindow] MascotModel.DirectoryPath から取得: {_mascotDirectory}");
            Debug.WriteLine($"[MascotEditWindow] ディレクトリ存在確認: {Directory.Exists(_mascotDirectory)}");

            if (string.IsNullOrEmpty(_mascotDirectory))
            {
                Debug.WriteLine($"[MascotEditWindow] エラー: MascotModel.DirectoryPath が空です");
                GD.PrintErr("MascotModel.DirectoryPath が空です");
                return;
            }

            // _Ready()が完了してから初期化処理を実行
            Debug.WriteLine("[MascotEditWindow] CallDeferred を実行");
            CallDeferred(nameof(InitializeDeferred));
            Debug.WriteLine("[MascotEditWindow] Initialize() 完了");
        }

        private void InitializeDeferred()
        {
            Debug.WriteLine("[MascotEditWindow] InitializeDeferred() 開始");
            
            try
            {
                _settingControl.Initialize(_mascotModel);
                _settingControl.RequestReloadImageList += OnRequestReloadImageList;

                LoadMascotData();
                
                Debug.WriteLine("[MascotEditWindow] InitializeDeferred() 完了");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] InitializeDeferred エラー: {ex.Message}");
                Debug.WriteLine($"[MascotEditWindow] スタックトレース: {ex.StackTrace}");
                GD.PrintErr($"InitializeDeferred エラー: {ex.Message}");
            }
        }

        /// <summary>
        /// マスコットデータを読み込む
        /// </summary>
        private void LoadMascotData()
        {
            try
            {
                Debug.WriteLine($"[MascotEditWindow] ========== マスコットデータ読み込み開始 ==========");
                Debug.WriteLine($"[MascotEditWindow] マスコット名: {_mascotModel.Name}");

                LoadCoverImage();
                LoadImageList();

                Debug.WriteLine($"[MascotEditWindow] ========== マスコットデータ読み込み完了 ==========");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] データ読み込みエラー: {ex.Message}");
                Debug.WriteLine($"[MascotEditWindow] スタックトレース: {ex.StackTrace}");
                GD.PrintErr($"マスコットデータの読み込みに失敗しました。\n{ex.Message}");
            }
        }

        /// <summary>
        /// カバー画像を読み込む（cover.png固定）
        /// </summary>
        private void LoadCoverImage()
        {
            try
            {
                string coverPath = Path.Combine(_mascotDirectory, "cover.png");

                Debug.WriteLine($"[MascotEditWindow] カバー画像パス: {coverPath}");

                if (File.Exists(coverPath))
                {
                    var texture = ImageLoadHelper.LoadGodotTexture(coverPath);
                    if (texture != null)
                    {
                        _coverTextureRect.Texture = texture;
                        Debug.WriteLine("[MascotEditWindow] カバー画像を読み込みました");
                    }
                    else
                    {
                        Debug.WriteLine("[MascotEditWindow] カバー画像の読み込みに失敗しました");
                    }
                }
                else
                {
                    Debug.WriteLine("[MascotEditWindow] カバー画像（cover.png）が見つかりません");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] カバー画像読み込みエラー: {ex.Message}");
            }
        }

        /// <summary>
        /// 画像一覧を読み込み、単一の画像セットとして表示する
        /// </summary>
        private void LoadImageList()
        {
            try
            {
                _imageItems.Clear();
                _imageList.Clear();

                if (!Directory.Exists(_mascotDirectory))
                {
                    Debug.WriteLine($"[MascotEditWindow] マスコットディレクトリが存在しません: {_mascotDirectory}");
                    return;
                }

                Debug.WriteLine($"[MascotEditWindow] 画像一覧を読み込み中: {_mascotDirectory}");

                // 1マスコット = 1画像セットとして再構築
                var allFiles = Directory.GetFiles(_mascotDirectory);
                var imageSet = MascotImageSetBuilder.CreateFromPaths(_mascotModel.Name, allFiles);

                if (imageSet.Image == null)
                {
                    imageSet.Image = imageSet.GetPrimaryImage() ?? imageSet.GetAllImages().FirstOrDefault();
                }

                if (imageSet.Image != null || imageSet.GetAllImages().Any())
                {
                    _imageItems.Add(imageSet);
                }

                // ItemListには単一の画像セットを表示
                _imageList.FixedIconSize = new Vector2I(120, 120);
                foreach (var listItem in _imageItems)
                {
                    var thumbnail = listItem.GetPrimaryImage() ?? listItem.Image;
                    if (thumbnail?.ImageSource != null)
                    {
                        _imageList.AddItem(_mascotModel.Name);
                        var texture = ImageLoadHelper.LoadGodotTexture(thumbnail.ImagePath);
                        if (texture != null)
                        {
                            _imageList.SetItemIcon(_imageList.ItemCount - 1, texture);
                        }
                    }
                }

                if (_imageItems.Count > 0)
                {
                    _imageList.Select(0);
                    _settingControl.SelectedMascotImageSet = _imageItems[0];
                }
                else
                {
                    _settingControl.SelectedMascotImageSet = null;
                }

                Debug.WriteLine($"[MascotEditWindow] 単一画像セットをItemListに設定: count={_imageItems.Count}");

            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] 画像一覧読み込みエラー: {ex.Message}");
                Debug.WriteLine($"[MascotEditWindow] スタックトレース: {ex.StackTrace}");
            }
        }

        /// <summary>
        /// 画像選択変更イベント
        /// </summary>
        private void OnImageSelected(long index)
        {
            if (index >= 0 && index < _imageItems.Count)
            {
                _settingControl.SelectedMascotImageSet = _imageItems[(int)index];
            }
            else
            {
                _settingControl.SelectedMascotImageSet = null;
            }
        }

        /// <summary>
        /// 画像リスト再読み込みリクエスト
        /// </summary>
        private void OnRequestReloadImageList()
        {
            LoadImageList();
        }

        /// <summary>
        /// 保存ボタン
        /// </summary>
        private void OnSaveButtonPressed()
        {
            try
            {
                // 表示名が変更された場合の処理
                string newName = _settingControl.GetDisplayName();

                if (string.IsNullOrEmpty(newName))
                {
                    GD.PrintErr("表示名を入力してください。");
                    return;
                }

                // システムプロンプトを保存
                _settingControl.SaveConfig();

                Debug.WriteLine($"[MascotEditWindow] マスコット情報を保存しました: {newName}");
                GD.Print("マスコット情報を保存しました。");

                QueueFree();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] 保存エラー: {ex.Message}");
                GD.PrintErr($"保存に失敗しました。\n{ex.Message}");
            }
        }

        /// <summary>
        /// キャンセルボタン
        /// </summary>
        private void OnCancelButtonPressed()
        {
            QueueFree();
        }

        /// <summary>
        /// 画像追加ボタンのイベントハンドラー
        /// </summary>
        private void OnAddImageButtonPressed()
        {
            try
            {
                string[] selectedFiles = ShowOpenFileDialogViaPowerShell();

                if (selectedFiles == null || selectedFiles.Length == 0)
                {
                    return;
                }

                // CLIXMLなどの進行状況ストリームが混入した場合や、空文字がある場合の防護フィルタリング
                var validFiles = new List<string>();
                foreach (var file in selectedFiles)
                {
                    var trimmed = file.Trim();
                    if (!string.IsNullOrEmpty(trimmed) && 
                        !trimmed.StartsWith("<") && 
                        !trimmed.StartsWith("#") && 
                        File.Exists(trimmed))
                    {
                        validFiles.Add(trimmed);
                    }
                }

                if (validFiles.Count == 0)
                {
                    Debug.WriteLine("[MascotEditWindow] 画像追加: 有効なファイルパスが選択されませんでした。");
                    return;
                }

                try
                {
                    foreach (var sourceFile in validFiles)
                    {
                        string fileName = Path.GetFileName(sourceFile);
                        string destPath = Path.Combine(_mascotDirectory, fileName);

                        if (File.Exists(destPath))
                        {
                            string nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
                            string extension = Path.GetExtension(fileName);
                            int counter = 1;

                            while (File.Exists(destPath))
                            {
                                fileName = $"{nameWithoutExt}_{counter}{extension}";
                                destPath = Path.Combine(_mascotDirectory, fileName);
                                counter++;
                            }
                        }

                        File.Copy(sourceFile, destPath);
                        Debug.WriteLine($"[MascotEditWindow] 画像をコピーしました: {sourceFile} -> {destPath}");
                    }

                    // リストを再読み込み
                    LoadImageList();
                    
                    // SettingControlにも通知して再読み込み
                    if (_imageItems.Count > 0)
                    {
                        _settingControl.SelectedMascotImageSet = _imageItems[0];
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[MascotEditWindow] 画像追加エラー: {ex.Message}");
                    GD.PrintErr($"画像の追加に失敗しました。\n{ex.Message}");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] 画像追加ダイアログ表示エラー: {ex.Message}");
                GD.PrintErr($"画像の追加に失敗しました。\n{ex.Message}");
            }
        }

        /// <summary>
        /// PowerShell経由でOS標準のファイル選択ダイアログを表示し、選択されたファイルパスを取得する
        /// </summary>
        private string[] ShowOpenFileDialogViaPowerShell()
        {
            try
            {
                // Windows Forms の OpenFileDialog を表示する PowerShell スクリプト
                // ProgressPreference を SilentlyContinue にして進捗表示ストリームの出力を完全に抑制します
                string script = @"
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '画像を選択'
$dialog.Filter = '画像ファイル (*.png;*.jpg;*.jpeg;*.gif;*.webp)|*.png;*.jpg;*.jpeg;*.gif;*.webp|すべてのファイル (*.*)|*.*'
$dialog.Multiselect = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    $dialog.FileNames | ForEach-Object { Write-Output $_ }
}
";
                // 文字化けやエスケープの問題を回避するため Base64 でエンコードして渡す (UTF-16LEが必要)
                byte[] bytes = System.Text.Encoding.Unicode.GetBytes(script);
                string base64 = Convert.ToBase64String(bytes);

                var startInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -ExecutionPolicy Bypass -EncodedCommand {base64}",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };

                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        return Array.Empty<string>();
                    }

                    string output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit();

                    if (string.IsNullOrWhiteSpace(output))
                    {
                        return Array.Empty<string>();
                    }

                    // 改行区切りで結果を取得
                    return output.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MascotEditWindow] PowerShellダイアログ起動エラー: {ex.Message}");
                return Array.Empty<string>();
            }
        }
    }
}
