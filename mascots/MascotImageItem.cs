using DesktopAiMascot.utils;
using Godot;
using System;
using System.Diagnostics;

namespace DesktopAiMascot.mascots
{
    /// <summary>
    /// 画像一覧表示用のアイテム (Godot版)
    /// </summary>
    public class MascotImageItem
    {
        public string ImagePath { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;

        private Texture2D? _cachedImage;

        /// <summary>
        /// 画像をTexture2Dとして取得（Godot表示用）
        /// </summary>
        public Texture2D? ImageSource
        {
            get
            {
                if (_cachedImage != null)
                {
                    return _cachedImage;
                }

                try
                {
                    var texture = ImageLoadHelper.LoadGodotTexture(ImagePath);
                    if (texture != null)
                    {
                        _cachedImage = texture;
                        return texture;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[MascotImageItem] 画像読み込みエラー ({FileName}): {ex.Message}");
                }

                return null;
            }
        }

        /// <summary>
        /// 後方互換用：Imageプロパティ (Godot.Imageとして返す)
        /// 実用上はImageSourceがよく使われます
        /// </summary>
        public Godot.Image? Image
        {
            get
            {
                return ImageSource?.GetImage();
            }
        }

        public void Dispose()
        {
            _cachedImage?.Dispose();
            _cachedImage = null;
        }

        public int Width
        {
            get
            {
                return ImageSource?.GetWidth() ?? 0;
            }
        }

        public int Height
        {
            get
            {
                return ImageSource?.GetHeight() ?? 0;
            }
        }
    }
}
