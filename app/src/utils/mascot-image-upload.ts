export type MascotImageSource = string | Blob;

export interface SaveMascotImageResult {
    success: boolean;
    path?: string;
    error?: string;
}

export interface SelectedMascotImage {
    source: MascotImageSource;
    previewUrl: string;
    name: string;
    release: () => void;
}

function selectBrowserImage(): Promise<SelectedMascotImage | null> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            const previewUrl = URL.createObjectURL(file);
            resolve({
                source: file,
                previewUrl,
                name: file.name,
                release: () => URL.revokeObjectURL(previewUrl)
            });
        };
        input.click();
    });
}

export async function selectMascotImage(): Promise<SelectedMascotImage | null> {
    if (window.electronAPI?.isWeb) {
        return await selectBrowserImage();
    }
    const result = await window.electronAPI?.selectLocalImage();
    if (!result?.success) return null;
    if (result.path.startsWith('data:image/')) {
        const blob = dataUrlToBlob(result.path);
        const previewUrl = URL.createObjectURL(blob);
        return {
            source: blob,
            previewUrl,
            name: result.name,
            release: () => URL.revokeObjectURL(previewUrl)
        };
    }
    return {
        source: result.path,
        previewUrl: result.path,
        name: result.name,
        release: () => undefined
    };
}

export function dataUrlToBlob(dataUrl: string): Blob {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
        throw new Error('有効なBase64画像ではありません。');
    }

    const raw = window.atob(match[2]);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index++) {
        bytes[index] = raw.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1] });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('BlobのData URL変換に失敗しました。'));
        reader.readAsDataURL(blob);
    });
}

export function canvasToImageBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('Canvasの画像変換に失敗しました。'));
            }
        }, type, quality);
    });
}

export async function imageSourceToBlob(source: MascotImageSource): Promise<Blob> {
    if (source instanceof Blob) return source;
    if (source.startsWith('data:')) return dataUrlToBlob(source);

    const response = await fetch(source);
    if (!response.ok) {
        throw new Error(`画像の読み込みに失敗しました: HTTP ${response.status}`);
    }
    return response.blob();
}

async function postMultipartImage(mascotId: string, filename: string, blob: Blob): Promise<SaveMascotImageResult> {
    const formData = new FormData();
    formData.append('mascotId', mascotId);
    formData.append('filename', filename);
    formData.append('image', blob, filename.split('/').pop() || 'image.png');

    const response = await fetch('/api/mascots/save-image', {
        method: 'POST',
        body: formData
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as SaveMascotImageResult;
}

async function postJsonImage(mascotId: string, filename: string, blob: Blob): Promise<SaveMascotImageResult> {
    const base64Data = await blobToDataUrl(blob);
    const response = await fetch('/api/mascots/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mascotId, filename, base64Data })
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as SaveMascotImageResult;
}

export async function saveMascotImageSource(
    mascotId: string,
    filename: string,
    source: MascotImageSource
): Promise<SaveMascotImageResult> {
    const isWeb = window.electronAPI?.isWeb === true;
    if (!isWeb && typeof source === 'string' && source.startsWith('data:')) {
        if (!window.electronAPI?.saveMascotImage) {
            throw new Error('electronAPI.saveMascotImage is not available');
        }
        return await window.electronAPI.saveMascotImage(mascotId, filename, source);
    }

    const blob = await imageSourceToBlob(source);
    if (isWeb) {
        try {
            return await postMultipartImage(mascotId, filename, blob);
        } catch (multipartError) {
            console.warn('[Upload] multipart画像保存に失敗したためJSON互換経路で再試行します:', multipartError);
            return await postJsonImage(mascotId, filename, blob);
        }
    }

    if (!window.electronAPI?.saveMascotImage) {
        throw new Error('electronAPI.saveMascotImage is not available');
    }
    return await window.electronAPI.saveMascotImage(mascotId, filename, await blobToDataUrl(blob));
}

export function getImageExtension(source: MascotImageSource): string {
    const mimeType = source instanceof Blob
        ? source.type
        : source.match(/^data:([^;,]+);/)?.[1];
    const subtype = mimeType?.split('/')[1]?.toLowerCase();
    if (subtype === 'jpeg') return 'jpg';
    if (subtype === 'svg+xml') return 'svg';
    return subtype || 'png';
}
