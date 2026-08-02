export type GeminiImageModel = 'gemini-2.5-flash-image' | 'gemini-3.1-flash-image' | 'gemini-3-pro-image';
export type GeminiImageSize = '1K' | '2K' | '4K';

export interface GeminiImageGenerateParams {
    prompt: string;
    model?: GeminiImageModel;
    aspectRatio?: string;
    imageSize?: GeminiImageSize;
    initImage?: string;
}

interface GeminiImageResponse {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
    error?: { message?: string };
}

export class GeminiImageConnector {
    static async generateImage(params: GeminiImageGenerateParams, apiKey: string): Promise<string> {
        if (!apiKey) throw new Error('Google AI Studio APIキーが設定されていません。');

        const model = params.model || 'gemini-3.1-flash-image';
        const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;
        const parts: Array<Record<string, unknown>> = [{ text: params.prompt }];
        if (params.initImage) {
            const image = this.parseDataUrl(params.initImage);
            parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
        }

        const imageConfig: Record<string, string> = {
            aspectRatio: this.toAspectRatioEnum(params.aspectRatio || '1:1')
        };
        if (model !== 'gemini-2.5-flash-image') {
            imageConfig.imageSize = this.toImageSizeEnum(params.imageSize || '1K');
        }

        console.log(`[GeminiImageConnector] 画像${params.initImage ? '編集' : '生成'}リクエストを送信します: ${url}`);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        responseModalities: ['IMAGE'],
                        responseFormat: { image: imageConfig }
                    }
                })
            });
            const data = await this.readResponse(response);
            if (!response.ok) throw new Error(data.error?.message || `Gemini API returned status ${response.status}`);
            const imagePart = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
            if (!imagePart?.inlineData?.data) throw new Error('Gemini APIの応答に画像が含まれていません。');
            return imagePart.inlineData.data;
        } catch (error: any) {
            const message = this.sanitizeErrorMessage(error?.message || '不明なエラー', apiKey);
            console.error(`[GeminiImageConnector] Geminiとの接続エラー: ${message}`);
            throw new Error(`Geminiとの接続エラー: ${message}`);
        }
    }

    private static parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) throw new Error('入力画像のData URL形式が不正です。');
        return { mimeType: match[1] || 'image/png', base64: match[2] || '' };
    }

    private static toAspectRatioEnum(aspectRatio: string): string {
        const values: Record<string, string> = {
            '1:1': 'ASPECT_RATIO_ONE_BY_ONE',
            '2:3': 'ASPECT_RATIO_TWO_BY_THREE',
            '3:2': 'ASPECT_RATIO_THREE_BY_TWO',
            '3:4': 'ASPECT_RATIO_THREE_BY_FOUR',
            '4:3': 'ASPECT_RATIO_FOUR_BY_THREE',
            '4:5': 'ASPECT_RATIO_FOUR_BY_FIVE',
            '5:4': 'ASPECT_RATIO_FIVE_BY_FOUR',
            '9:16': 'ASPECT_RATIO_NINE_BY_SIXTEEN',
            '16:9': 'ASPECT_RATIO_SIXTEEN_BY_NINE',
            '21:9': 'ASPECT_RATIO_TWENTY_ONE_BY_NINE',
            '1:8': 'ASPECT_RATIO_ONE_BY_EIGHT',
            '8:1': 'ASPECT_RATIO_EIGHT_BY_ONE',
            '1:4': 'ASPECT_RATIO_ONE_BY_FOUR',
            '4:1': 'ASPECT_RATIO_FOUR_BY_ONE'
        };
        return values[aspectRatio] || values['1:1'];
    }

    private static toImageSizeEnum(imageSize: string): string {
        const values: Record<string, string> = {
            '1K': 'IMAGE_SIZE_ONE_K',
            '2K': 'IMAGE_SIZE_TWO_K',
            '4K': 'IMAGE_SIZE_FOUR_K'
        };
        return values[imageSize] || values['1K'];
    }

    private static async readResponse(response: Response): Promise<GeminiImageResponse> {
        const text = await response.text();
        if (!text) return {};
        try {
            return JSON.parse(text) as GeminiImageResponse;
        } catch {
            return { error: { message: `Gemini API returned status ${response.status}: ${text.slice(0, 300)}` } };
        }
    }

    private static sanitizeErrorMessage(message: string, apiKey: string): string {
        return message.replaceAll(apiKey, '[REDACTED]');
    }
}
