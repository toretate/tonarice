using System;
using System.IO;
using System.Collections.Generic;
using System.Diagnostics;
using Godot;

namespace DesktopAiMascot.mascots
{
    /**
     * マスコットのインスタンスを表すクラス
     */
    public class Mascot : IDisposable
    {
        // 現在のマスコットモデル
        public MascotModel? Model { get; private set; }
        public Vector2I Position { get; set; }
        public Vector2I Size { get; set; }
        public int CurrentFrame { get; private set; }
        private MascotImageItem[]? images;
        private Godot.Image? coverImage;
        private bool disposed = false;

        public Mascot(Vector2I position, Vector2I size)
        {
            Position = position;
            Size = size;
            CurrentFrame = 0;
        }

        public void Reload(MascotModel newModel)
        {
            Model?.Dispose();    // キャッシュ破棄

            Model = newModel;
            images = newModel.LoadImages();
            
            // Log for debugging
            Debug.WriteLine($"Mascot reloaded: {newModel.Name}, {images?.Length ?? 0} images.");
        }

        /// <summary>
        /// cover.pngを読み込む
        /// </summary>
        public Godot.Image? LoadCoverImage()
        {
            if (Model == null) return null;

            try
            {
                string coverPath = Path.Combine(Model.DirectoryPath, "cover.png");
                if (!File.Exists(coverPath))
                {
                    Debug.WriteLine($"[Mascot] cover.png not found: {coverPath}");
                    return null;
                }

                if (coverImage != null)
                {
                    coverImage.Dispose();
                }

                var img = new Godot.Image();
                var err = img.Load(coverPath);
                if (err == Godot.Error.Ok)
                {
                    coverImage = img;
                    Debug.WriteLine($"[Mascot] cover.png loaded: {coverPath}");
                    return coverImage;
                }
                return null;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Mascot] Error loading cover.png: {ex.Message}");
                return null;
            }
        }

        public void MoveTo(Vector2I newPosition)
        {
            Position = newPosition;
        }

        public bool IsClicked(Vector2I clickPoint)
        {
            Rect2I bounds = new Rect2I(Position, Size);
            return bounds.HasPoint(clickPoint);
        }

        /**
         * 現在のフレームの画像のクローンを取得する
         */
        public Godot.Image? GetCurrentImageClone()
        {
            try
            {
                if (images == null || images.Length == 0) return null;
                var current = images[CurrentFrame];
                if (current?.Image == null) return null;
                
                var newImg = new Godot.Image();
                newImg.CopyFrom(current.Image);
                return newImg;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// cover.pngのクローンを取得する
        /// </summary>
        public Godot.Image? GetCoverImageClone()
        {
            try
            {
                if (coverImage == null) return null;
                var newImg = new Godot.Image();
                newImg.CopyFrom(coverImage);
                return newImg;
            }
            catch
            {
                return null;
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;

            if (images != null)
            {
                foreach (var im in images)
                {
                    im?.Dispose();
                }
                images = null;
            }

            if (coverImage != null)
            {
                coverImage.Dispose();
                coverImage = null;
            }

            GC.SuppressFinalize(this);
        }
    }
}
