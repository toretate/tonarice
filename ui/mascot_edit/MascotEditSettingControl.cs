using Godot;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using DesktopAiMascot.mascots;
using DesktopAiMascot.aiservice;
using DesktopAiMascot.aiservice.image;
using DesktopAiMascot.utils;
using DesktopAiMascot.skills;
using Button = Godot.Button;
using Label = Godot.Label;
using FileDialog = Godot.FileDialog;

namespace DesktopAiMascot.ui.mascot_edit
{
	/// <summary>
	/// マスコット編集設定コントロール
	/// </summary>
	public partial class MascotEditSettingControl : VBoxContainer
	{
		public event Action? RequestReloadImageList;

		private MascotModel? _mascotModel;
		private string _mascotDirectory = string.Empty;
		private string _configPath = string.Empty;
		private MascotConfig _mascotConfig = new MascotConfig();

		private MascotImageSet? _selectedMascotImageSet;
		public MascotImageSet? SelectedMascotImageSet
		{
			get => _selectedMascotImageSet;
			set
			{
				_selectedMascotImageSet = value;
				UpdateSelectionState();
			}
		}

		private LineEdit _displayNameLineEdit = null!;
		private Label _configPathLabel = null!;
		private Button _editButton = null!;
		private LineEdit _profileFileLineEdit = null!;
		private Button _generateButton = null!;
		private OptionButton _profileModelComboBox = null!;
		private TextEdit _profileTextEdit = null!;
		private Button _removeBackgroundButton = null!;
		private OptionButton _bgRemovalServiceComboBox = null!;
		private Button _restoreBackgroundButton = null!;
		private Button _addImageButton = null!;
		private MarginContainer _angleViewContainer = null!;
		private MarginContainer _emoteGenerationContainer = null!;
		private AngleViewControl? _angleViewControl;
		private EmoteGenerationTabPage? _emoteGenerationTabPage;

		private GoogleAiStudioService? _googleAiService;
		private ComfyQwen3ImageEditService? _comfyQwen3ImageEditService;
		private RemoveBGImage? _removeBgImage;
		private GenerateAngleImage? _angleImageGenerator;

		public override void _Ready()
		{
			_displayNameLineEdit = GetNode<LineEdit>("%DisplayNameLineEdit");
			_configPathLabel = GetNode<Label>("%ConfigPathLabel");
			_editButton = GetNode<Button>("%EditButton");
			_profileFileLineEdit = GetNode<LineEdit>("%ProfileFileLineEdit");
			_generateButton = GetNode<Button>("%GenerateButton");
			_profileModelComboBox = GetNode<OptionButton>("%ProfileModelComboBox");
			_profileTextEdit = GetNode<TextEdit>("%ProfileTextEdit");
			_removeBackgroundButton = GetNode<Button>("%RemoveBackgroundButton");
			_bgRemovalServiceComboBox = GetNode<OptionButton>("%BgRemovalServiceComboBox");
			_restoreBackgroundButton = GetNode<Button>("%RestoreBackgroundButton");
			_addImageButton = GetNode<Button>("%AddImageButton");
			_angleViewContainer = GetNode<MarginContainer>("%AngleViewContainer");
			_emoteGenerationContainer = GetNode<MarginContainer>("%EmoteGenerationContainer");
			_angleViewControl = GetNode<AngleViewControl>("%AngleViewControl");
			_emoteGenerationTabPage = GetNode<EmoteGenerationTabPage>("%EmoteGenerationTabPage");

			_editButton.Pressed += OnEditButtonPressed;
			_generateButton.Pressed += OnGenerateButtonPressed;
			_removeBackgroundButton.Pressed += OnRemoveBackgroundButtonPressed;
			_restoreBackgroundButton.Pressed += OnRestoreBackgroundButtonPressed;
			_addImageButton.Pressed += OnAddImageButtonPressed;
		}

		/// <summary>
		/// MascotModelで初期化
		/// </summary>
		public void Initialize(MascotModel mascotModel)
		{
			Debug.WriteLine("[MascotEditSettingControl] Initialize() 開始");
			
			_mascotModel = mascotModel;
			_mascotDirectory = _mascotModel.DirectoryPath;
			_configPath = Path.Combine(_mascotDirectory, "config.yaml");

			Debug.WriteLine($"[MascotEditSettingControl] MascotDirectory: {_mascotDirectory}");
			Debug.WriteLine($"[MascotEditSettingControl] ConfigPath: {_configPath}");

			_googleAiService = new GoogleAiStudioService();
			_googleAiService.Initialize();
			_comfyQwen3ImageEditService = new ComfyQwen3ImageEditService();
			_removeBgImage = new RemoveBGImage(_mascotDirectory);
			_angleImageGenerator = new GenerateAngleImage(_googleAiService, _comfyQwen3ImageEditService);

			InitializeBackgroundRemovalServices();
			InitializeGenerateProfileModelComboBox();
			InitializeAngleViewControl();
			LoadMascotData();
			
			Debug.WriteLine("[MascotEditSettingControl] Initialize() 完了");
		}

		private void InitializeAngleViewControl()
		{
			if (_angleViewControl == null)
			{
				Debug.WriteLine("[MascotEditSettingControl] AngleViewControl is null, skipping initialization");
				return;
			}

			Debug.WriteLine("[MascotEditSettingControl] AngleViewControl initialization started");
			
			// イベントハンドラーを登録
			_angleViewControl.LeftImageClick += OnLeftImageClick;
			_angleViewControl.RightImageClick += OnRightImageClick;
			_angleViewControl.AboveImageClick += OnAboveImageClick;
			_angleViewControl.BelowImageClick += OnBelowImageClick;
			_angleViewControl.BehindImageClick += OnBehindImageClick;
			
			// モデル選択のイベントハンドラー
			_angleViewControl.ImageModelComboBox.ItemSelected += OnAngleImageModelChanged;
			
			// 保存されたモデルインデックスを復元
			if (SystemConfig.Instance.AngleImageModelIndex >= 0 &&
				SystemConfig.Instance.AngleImageModelIndex < _angleViewControl.ImageModelComboBox.ItemCount)
			{
				_angleViewControl.ImageModelComboBox.Selected = SystemConfig.Instance.AngleImageModelIndex;
			}

			Debug.WriteLine("[MascotEditSettingControl] AngleViewControl initialization completed");
		}

		private void OnAngleImageModelChanged(long index)
		{
			SystemConfig.Instance.AngleImageModelIndex = (int)index;
			SystemConfig.Instance.Save();
			Debug.WriteLine($"[MascotEditSettingControl] Angle image model changed to index: {index}");
		}

		private void InitializeBackgroundRemovalServices()
		{
			try
			{
				var services = ImageAiManager.Instance.ImageAiServices.Values.ToList();

				if (services.Count > 0)
				{
					_bgRemovalServiceComboBox.Clear();
					foreach (var service in services)
					{
						_bgRemovalServiceComboBox.AddItem(service.Name);
					}
					_bgRemovalServiceComboBox.Selected = 0;
				}
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[MascotEditSettingControl] 背景削除サービス初期化エラー: {ex.Message}");
			}
		}

		private void InitializeGenerateProfileModelComboBox()
		{
			try
			{
				var serviceTable = LlmManager.GetAvailableLlmServices;
				var services = new List<string>();
				
				foreach (System.Data.DataRow row in serviceTable.Rows)
				{
					var name = row["Name"]?.ToString() ?? string.Empty;
					if (!string.IsNullOrEmpty(name))
					{
						services.Add(name);
					}
				}

				_profileModelComboBox.Clear();
				foreach (var service in services)
				{
					_profileModelComboBox.AddItem(service);
				}

				if (services.Count > 0)
				{
					string currentLlm = SystemConfig.Instance.LlmService;
					int index = services.IndexOf(currentLlm);
					_profileModelComboBox.Selected = index >= 0 ? index : 0;
				}
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[MascotEditSettingControl] プロフィール生成LLM初期化エラー: {ex.Message}");
			}
		}

		private void LoadMascotData()
		{
			if (_mascotModel == null) return;

			_displayNameLineEdit.Text = _mascotModel.Name;
			LoadSystemPrompt();
		}

		private void LoadSystemPrompt()
		{
			try
			{
				if (File.Exists(_configPath))
				{
					_mascotConfig = MascotConfigIO.LoadFromFile(_configPath);
					_profileTextEdit.Text = MascotConfigIO.SaveSystemPrompt(_mascotConfig.SystemPrompt);
					_configPathLabel.Text = Path.GetFileName(_configPath);
				}
				else
				{
					_mascotConfig = new MascotConfig();
					_profileTextEdit.Text = MascotConfigIO.SaveSystemPrompt(_mascotConfig.SystemPrompt);
					_configPathLabel.Text = Path.GetFileName(_configPath);
				}
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[MascotEditSettingControl] システムプロンプト読み込みエラー: {ex.Message}");
				_profileTextEdit.Text = string.Empty;
			}
		}

		private void UpdateSelectionState()
		{
			bool isSelected = SelectedMascotImageSet != null && SelectedMascotImageSet.Image != null;
			_removeBackgroundButton.Disabled = !isSelected;

			if (isSelected && SelectedMascotImageSet != null && SelectedMascotImageSet.Image != null)
			{
				try
				{
					var imageItem = SelectedMascotImageSet.Image;
					string directory = Path.GetDirectoryName(imageItem.ImagePath) ?? "";
					string fileNameWithoutExt = Path.GetFileNameWithoutExtension(imageItem.ImagePath);
					string extension = Path.GetExtension(imageItem.ImagePath);

					var backupFiles = Directory.GetFiles(directory, $"{fileNameWithoutExt}.*.back{extension}");
					_restoreBackgroundButton.Disabled = backupFiles.Length == 0;

					// 角度画像を更新
					UpdateAngleImages();
					
					// 表情差分作成タブを初期化
					_emoteGenerationTabPage?.Initialize(imageItem.ImagePath);
				}
				catch (Exception ex)
				{
					Debug.WriteLine($"[MascotEditSettingControl] Image selection update error: {ex.Message}");
					_restoreBackgroundButton.Disabled = true;
				}
			}
			else
			{
				_restoreBackgroundButton.Disabled = true;
			}
		}

		public string GetDisplayName()
		{
			return _displayNameLineEdit.Text.Trim();
		}

		public void SaveConfig()
		{
			try
			{
				_mascotConfig.SystemPrompt = MascotConfigIO.LoadSystemPrompt(_profileTextEdit.Text);
				MascotConfigIO.SaveToYaml(_mascotConfig, _configPath);
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[MascotEditSettingControl] システムプロンプト保存エラー: {ex.Message}");
				throw;
			}
		}

		private void OnEditButtonPressed()
		{
			try
			{
				if (!File.Exists(_configPath))
				{
					GD.PrintErr($"config.yamlが見つかりません。\n\nパス: {_configPath}");
					return;
				}

				OS.ShellOpen(_configPath);
			}
			catch (Exception ex)
			{
				GD.PrintErr($"外部エディタの起動に失敗しました。\n{ex.Message}");
			}
		}

		private async void OnGenerateButtonPressed()
		{
			string filePath = _profileFileLineEdit.Text?.Trim() ?? string.Empty;
			if (string.IsNullOrWhiteSpace(filePath))
			{
				GD.PrintErr("ファイルパスを指定してください。");
				return;
			}

			if (!File.Exists(filePath))
			{
				GD.PrintErr("指定されたファイルが見つかりません。");
				return;
			}

			int selectedIndex = _profileModelComboBox.Selected;
			if (selectedIndex < 0)
			{
				GD.PrintErr("LLMサービスを選択してください。");
				return;
			}

			try
			{
				string selectedService = _profileModelComboBox.GetItemText(selectedIndex);

				if (string.Equals(selectedService, "LM Studio", StringComparison.OrdinalIgnoreCase))
				{
					SystemConfig.Instance.ModelName = "qwen/qwen3-vl-8b";
					SystemConfig.Instance.Save();
				}

				var service = LlmManager.CreateService(selectedService);
				if (service == null)
				{
					GD.PrintErr("LLMサービスの初期化に失敗しました。");
					return;
				}

				_generateButton.Disabled = true;

				var skill = new GenerateProfileSkill(service);
				var result = await skill.GenerateProfileFromTextAsync(filePath, "expand");

				if (!string.IsNullOrWhiteSpace(result))
				{
					_profileTextEdit.Text = result;
				}
				else
				{
					GD.PrintErr("プロフィール生成に失敗しました。");
				}
			}
			catch (Exception ex)
			{
				GD.PrintErr($"プロフィール生成に失敗しました。\n{ex.Message}");
			}
			finally
			{
				_generateButton.Disabled = false;
			}
		}

		private async void OnRemoveBackgroundButtonPressed()
		{
			if (SelectedMascotImageSet == null || SelectedMascotImageSet.Image == null) return;
			var targetImage = SelectedMascotImageSet.Image;

			try
			{
				int selectedIndex = _bgRemovalServiceComboBox.Selected;
				if (selectedIndex < 0)
				{
					GD.PrintErr("背景削除サービスが選択されていません。");
					return;
				}

				var services = ImageAiManager.Instance.ImageAiServices.Values.ToList();
				if (selectedIndex >= services.Count)
				{
					GD.PrintErr("無効な背景削除サービスです。");
					return;
				}

				var imageService = services[selectedIndex];

				_removeBackgroundButton.Disabled = true;

				if (_removeBgImage == null) return;

				string? backupFileName = await _removeBgImage.ExecuteAsync(targetImage.ImagePath, imageService);

				if (!string.IsNullOrEmpty(backupFileName))
				{
					RequestReloadImageList?.Invoke();

					GD.Print($"背景を削除しました。\n元のファイルは {backupFileName} としてバックアップされました。");

					UpdateSelectionState();
				}
				else
				{
					GD.PrintErr("背景削除処理に失敗しました。");
				}
			}
			catch (Exception ex)
			{
				GD.PrintErr($"背景削除処理に失敗しました。\n{ex.Message}");
			}
			finally
			{
				_removeBackgroundButton.Disabled = false;
			}
		}

		private void OnRestoreBackgroundButtonPressed()
		{
			if (SelectedMascotImageSet == null || SelectedMascotImageSet.Image == null) return;
			var targetImage = SelectedMascotImageSet.Image;

			try
			{
				string directory = Path.GetDirectoryName(targetImage.ImagePath) ?? "";
				string fileNameWithoutExt = Path.GetFileNameWithoutExtension(targetImage.ImagePath);
				string extension = Path.GetExtension(targetImage.ImagePath);

				var backupFiles = Directory.GetFiles(directory, $"{fileNameWithoutExt}.*.back{extension}")
					.OrderByDescending(f => f)
					.ToArray();

				if (backupFiles.Length == 0)
				{
					GD.Print("バックアップファイルが見つかりませんでした。");
					return;
				}

				string latestBackup = backupFiles[0];
				string backupFileName = Path.GetFileName(latestBackup);

				// TODO: 確認ダイアログの実装
				GD.Print($"背景削除前の画像に戻します。バックアップファイル: {backupFileName}");

				GC.Collect();
				GC.WaitForPendingFinalizers();
				GC.Collect();

				System.Threading.Thread.Sleep(100);

				File.Copy(latestBackup, targetImage.ImagePath, true);
				File.Delete(latestBackup);

				RequestReloadImageList?.Invoke();
				GD.Print("背景削除前の画像に戻しました。");

				UpdateSelectionState();
			}
			catch (Exception ex)
			{
				GD.PrintErr($"画像の復元に失敗しました。\n{ex.Message}");
			}
		}

		private void OnAddImageButtonPressed()
		{
			try
			{
				var fileDialog = new FileDialog();
				fileDialog.Title = "画像を選択";
				fileDialog.Filters = new[] { "*.png,*.jpg,*.jpeg,*.gif,*.webp ; 画像ファイル" };
				fileDialog.FileMode = FileDialog.FileModeEnum.OpenFiles;
				fileDialog.Access = FileDialog.AccessEnum.Filesystem;

				fileDialog.FilesSelected += (files) =>
				{
					try
					{
						foreach (var sourceFile in files)
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
						}

						RequestReloadImageList?.Invoke();
					}
					catch (Exception ex)
					{
						GD.PrintErr($"画像の追加に失敗しました。\n{ex.Message}");
					}
				};

				AddChild(fileDialog);
				fileDialog.PopupCentered(new Vector2I(800, 600));
			}
			catch (Exception ex)
			{
				GD.PrintErr($"画像の追加に失敗しました。\n{ex.Message}");
			}
		}

		private void OnLeftImageClick()
		{
			GenerateAngleImageWrapper("left", _angleViewControl?.LeftImage);
		}

		private void OnRightImageClick()
		{
			GenerateAngleImageWrapper("right", _angleViewControl?.RightImage);
		}

		private void OnAboveImageClick()
		{
			GenerateAngleImageWrapper("above", _angleViewControl?.AboveImage);
		}

		private void OnBelowImageClick()
		{
			GenerateAngleImageWrapper("below", _angleViewControl?.BelowImage);
		}

		private void OnBehindImageClick()
		{
			GenerateAngleImageWrapper("behind", _angleViewControl?.BehindImage);
		}

		/// <summary>
		/// 角度画像生成のラッパーメソッド
		/// </summary>
		private void GenerateAngleImageWrapper(string direction, TextureRect? targetImageControl)
		{
			if (_angleViewControl == null || targetImageControl == null)
			{
				GD.PrintErr("AngleViewControl or target control is null");
				return;
			}

			// フロント画像が選択されているか確認
			if (_angleViewControl.FrontImage.Texture == null)
			{
				GD.Print("先に画像一覧から画像を選択してください。");
				// TODO: ダイアログ表示
				return;
			}

			// フロント画像のパスを取得
			string frontImageFileName = "cover.png";
			string frontImagePath = Path.Combine(_mascotDirectory, "cover.png");

			// 選択された画像があればそれを使用
			if (SelectedMascotImageSet != null && SelectedMascotImageSet.Image != null)
			{
				frontImageFileName = SelectedMascotImageSet.Image.FileName;
				frontImagePath = SelectedMascotImageSet.Image.ImagePath;
			}
			else if (!File.Exists(frontImagePath))
			{
				GD.PrintErr("フロント画像が見つかりません");
				return;
			}

			// 非同期で画像生成を実行
			GenerateAngleImage(direction, frontImageFileName, frontImagePath, targetImageControl);
		}

		/// <summary>
		/// 角度画像を生成
		/// </summary>
		private async void GenerateAngleImage(string direction, string frontImageFileName, string frontImagePath, TextureRect targetImageControl)
		{
			if (_angleImageGenerator == null || _angleViewControl == null)
			{
				GD.PrintErr("Angle image generator is not initialized");
				return;
			}

			try
			{
				Debug.WriteLine($"[MascotEditSettingControl] 角度画像生成開始: {direction}");
				
				// ステータス表示
				_angleViewControl.SetAngleStatus(direction, "生成中...");

				// 選択されたモデルを取得
				string selectedModel = GetSelectedAngleImageModel();
				Debug.WriteLine($"[MascotEditSettingControl] 選択されたモデル: {selectedModel}");

				// 画像生成を実行
				var outputPath = await _angleImageGenerator.ExecuteAsync(
					direction,
					selectedModel,
					frontImagePath,
					_mascotDirectory,
					frontImageFileName);

				if (!string.IsNullOrEmpty(outputPath))
				{
					Debug.WriteLine($"[MascotEditSettingControl] 画像生成成功: {outputPath}");
					
					// 生成された画像を読み込んで表示
					var texture = utils.ImageLoadHelper.LoadGodotTexture(outputPath);
					if (texture != null)
					{
						targetImageControl.Texture = texture;
						
						// 画像リストをリロード
						RequestReloadImageList?.Invoke();
						
						GD.Print($"{direction}方向の画像を生成しました。");
					}
					else
					{
						GD.PrintErr("生成された画像の読み込みに失敗しました");
					}
				}
				else
				{
					GD.PrintErr("画像生成に失敗しました");
				}
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[MascotEditSettingControl] 画像生成エラー: {ex.Message}");
				Debug.WriteLine($"[MascotEditSettingControl] スタックトレース: {ex.StackTrace}");
				GD.PrintErr($"画像生成に失敗しました。\n{ex.Message}");
			}
			finally
			{
				// ステータスをクリア
				_angleViewControl?.SetAngleStatus(direction, null);
			}
		}

		/// <summary>
		/// 選択された角度画像生成モデルを取得
		/// </summary>
		private string GetSelectedAngleImageModel()
		{
			if (_angleViewControl == null)
			{
				return "gemini-2.5-flash-image";
			}

			return _angleViewControl.ImageModelComboBox.Selected switch
			{
				0 => "gemini-2.5-flash-image",
				1 => "gemini-3-pro-image-preview",
				2 => "qwen3-image-edit",
				_ => "gemini-2.5-flash-image"
			};
		}

		/// <summary>
		/// 角度画像を更新
		/// </summary>
		private void UpdateAngleImages()
		{
			if (_angleViewControl == null || SelectedMascotImageSet == null)
			{
				return;
			}

			Debug.WriteLine("[MascotEditSettingControl] UpdateAngleImages() 開始");

			// 各方向の画像を設定
			SetAngleImage("left", _angleViewControl.LeftImage);
			SetAngleImage("right", _angleViewControl.RightImage);
			SetAngleImage("above", _angleViewControl.AboveImage);
			SetAngleImage("below", _angleViewControl.BelowImage);
			SetAngleImage("behind", _angleViewControl.BehindImage);

			// フロント画像（選択された画像）を設定
			if (SelectedMascotImageSet.Image != null)
			{
				var frontTexture = utils.ImageLoadHelper.LoadGodotTexture(SelectedMascotImageSet.Image.ImagePath);
				if (frontTexture != null)
				{
					_angleViewControl.FrontImage.Texture = frontTexture;
					Debug.WriteLine($"[MascotEditSettingControl] Front image set: {SelectedMascotImageSet.Image.FileName}");
				}
			}

			Debug.WriteLine("[MascotEditSettingControl] UpdateAngleImages() 完了");
		}

		/// <summary>
		/// 指定された方向の角度画像を設定
		/// </summary>
		private void SetAngleImage(string angle, TextureRect targetControl)
		{
			if (SelectedMascotImageSet == null || targetControl == null)
			{
				return;
			}

			// 角度画像を検索
			if (SelectedMascotImageSet.AngleImages.TryGetValue(angle, out var angleImage))
			{
				var texture = utils.ImageLoadHelper.LoadGodotTexture(angleImage.ImagePath);
				if (texture != null)
				{
					targetControl.Texture = texture;
					Debug.WriteLine($"[MascotEditSettingControl] {angle} image set: {angleImage.FileName}");
					return;
				}
			}

			// 画像が見つからない場合はクリア
			targetControl.Texture = null;
			Debug.WriteLine($"[MascotEditSettingControl] {angle} image not found");
		}
	}

	internal class LlmServiceInfo
	{
		public string Name { get; set; } = string.Empty;
	}
}
