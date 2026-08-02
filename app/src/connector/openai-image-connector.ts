export type OpenAiImageQuality = 'low' | 'medium' | 'high' | 'auto';
export type OpenAiImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
export type OpenAiImageBackground = 'opaque' | 'auto';

export interface OpenAiImageGenerateParams {
    prompt: string;
    model?: string;
    quality?: OpenAiImageQuality;
    size?: OpenAiImageSize;
    background?: OpenAiImageBackground;
    initImage?: string;
}

interface OpenAiImageResponse {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
}

/**
 * OpenAI Images API を使用して画像を生成・編集するコネクター。
 */
export class OpenAiImageConnector {
    private static readonly baseUrl = 'https://api.openai.com/v1/images';

    static async generateImage(params: OpenAiImageGenerateParams, apiKey: string): Promise<string> {
        if (!apiKey.trim()) {
            throw new Error('OpenAI APIキーが設定されていません。');
        }

        const isEdit = Boolean(params.initImage);
        const url = `${this.baseUrl}/${isEdit ? 'edits' : 'generations'}`;
        console.log(`[OpenAiImageConnector] ${isEdit ? '画像編集' : '画像生成'}リクエストを送信します: ${url}`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: isEdit
                    ? { Authorization: `Bearer ${apiKey}` }
                    : {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                body: isEdit
                    ? this.createEditFormData(params)
                    : JSON.stringify(this.createGenerationPayload(params))
            });
            const data = await this.readResponse(response);
            if (!response.ok) {
                throw new Error(data.error?.message || `OpenAI Images API returned status ${response.status}`);
            }

            const base64Image = data.data?.[0]?.b64_json;
            if (!base64Image) {
                throw new Error('OpenAI Images APIから画像データが返されませんでした。');
            }
            return base64Image;
        } catch (error: any) {
            const message = this.sanitizeErrorMessage(error?.message || '不明なエラー', apiKey);
            console.error(`[OpenAiImageConnector] OpenAIとの接続エラー: ${message}`);
            throw new Error(`OpenAIとの接続エラー: ${message}`);
        }
    }

    private static async readResponse(response: Response): Promise<OpenAiImageResponse> {
        const responseText = await response.text();
        if (!responseText) return {};
        try {
            return JSON.parse(responseText) as OpenAiImageResponse;
        } catch {
            return {
                error: {
                    message: response.ok
                        ? 'OpenAI Images APIの応答形式が不正です。'
                        : `OpenAI Images API returned status ${response.status}: ${responseText.slice(0, 300)}`
                }
            };
        }
    }

    private static sanitizeErrorMessage(message: string, apiKey: string): string {
        return message
            .replaceAll(apiKey, '[REDACTED]')
            .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
    }

    private static createGenerationPayload(params: OpenAiImageGenerateParams) {
        return {
            model: params.model || 'gpt-image-2',
            prompt: params.prompt,
            n: 1,
            quality: params.quality || 'auto',
            size: params.size || 'auto',
            background: params.background || 'auto',
            output_format: 'png'
        };
    }

    private static createEditFormData(params: OpenAiImageGenerateParams): FormData {
        const { mimeType, bytes } = this.decodeDataUrl(params.initImage || '');
        const imageBuffer = Uint8Array.from(bytes).buffer as ArrayBuffer;
        const formData = new FormData();
        formData.append('model', params.model || 'gpt-image-2');
        formData.append('prompt', params.prompt);
        formData.append('image[]', new Blob([imageBuffer], { type: mimeType }), `input.${this.getExtension(mimeType)}`);
        formData.append('quality', params.quality || 'auto');
        formData.append('size', params.size || 'auto');
        formData.append('background', params.background || 'auto');
        formData.append('output_format', 'png');
        return formData;
    }

    private static decodeDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } {
        const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
        if (!match) {
            throw new Error('編集元画像の形式が不正です。');
        }
        return {
            mimeType: match[1] || 'image/png',
            bytes: Uint8Array.from(Buffer.from(match[2] || '', 'base64'))
        };
    }

    private static getExtension(mimeType: string): string {
        if (mimeType === 'image/jpeg') return 'jpg';
        if (mimeType === 'image/webp') return 'webp';
        return 'png';
    }
}
