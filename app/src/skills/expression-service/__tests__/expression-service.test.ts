import { beforeEach, describe, expect, test, vi } from 'vitest';

const generateOpenAiImageMock = vi.hoisted(() => vi.fn());

vi.mock('../../../connector/openai-image-connector', () => ({
    OpenAiImageConnector: {
        generateImage: generateOpenAiImageMock
    }
}));

import { AiExpressionService } from '../expression-service';

describe('AiExpressionService', () => {
    beforeEach(() => {
        generateOpenAiImageMock.mockReset();
    });

    test('generateExpressions_OpenAIでベース画像を使って表情スプライトを編集すること', async () => {
        generateOpenAiImageMock.mockResolvedValue('generated-sprite');

        const result = await AiExpressionService.generateExpressions(
            'data:image/webp;base64,aW1hZ2U=',
            '',
            [{ name: '喜び', label: 'joy' }],
            'キャラクターの絵柄を維持してください。',
            'openai',
            'gpt-image-2',
            [],
            'test-openai-key'
        );

        expect(generateOpenAiImageMock).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-image-2',
            prompt: expect.stringContaining('joy'),
            quality: 'high',
            size: '1024x1024',
            background: 'opaque',
            initImage: 'data:image/webp;base64,aW1hZ2U='
        }), 'test-openai-key');
        const request = generateOpenAiImageMock.mock.calls[0]?.[0];
        expect(request.prompt).not.toContain('[EMOTIONS]');
        expect(request.prompt).not.toContain('[__EMOTIONS_LABLE__]');
        expect(result).toEqual({
            success: true,
            imageBytes: 'data:image/png;base64,generated-sprite'
        });
    });

    test('generateExpressions_OpenAIのAPIキーが未設定の場合にエラーを返すこと', async () => {
        const result = await AiExpressionService.generateExpressions(
            '',
            '',
            [{ name: '通常', label: 'neutral' }],
            '表情を生成してください。',
            'openai',
            'gpt-image-2',
            [],
            ''
        );

        expect(generateOpenAiImageMock).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: false,
            error: 'OpenAI APIキーが設定されていません。'
        });
    });

    test('generateExpressions_OpenAIでベース画像がない場合に新規生成すること', async () => {
        generateOpenAiImageMock.mockResolvedValue('generated-sprite');

        await AiExpressionService.generateExpressions(
            '',
            '',
            [{ name: '通常', label: 'neutral' }],
            '[EMOTIONS] の表情を生成してください。',
            'openai',
            'gpt-image-2',
            [],
            'test-openai-key'
        );

        expect(generateOpenAiImageMock).toHaveBeenCalledWith(expect.objectContaining({
            initImage: undefined,
            prompt: expect.stringContaining('neutral')
        }), 'test-openai-key');
    });

    test('generateExpressions_OpenAIでベース画像を解決できない場合に生成を中止すること', async () => {
        const result = await AiExpressionService.generateExpressions(
            'missing-image.png',
            '',
            [{ name: '通常', label: 'neutral' }],
            '表情を生成してください。',
            'openai',
            'gpt-image-2',
            [],
            'test-openai-key'
        );

        expect(generateOpenAiImageMock).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: false,
            error: 'ベースキャラクター画像を読み込めませんでした。'
        });
    });

    test('generateExpressions_OpenAIコネクターのエラーを呼び出し元へ返すこと', async () => {
        generateOpenAiImageMock.mockRejectedValue(new Error('OpenAIとの接続エラー: rate limit'));

        const result = await AiExpressionService.generateExpressions(
            '',
            '',
            [{ name: '通常', label: 'neutral' }],
            '表情を生成してください。',
            'openai',
            'gpt-image-2',
            [],
            'test-openai-key'
        );

        expect(result).toEqual({
            success: false,
            error: 'OpenAIとの接続エラー: rate limit'
        });
    });
});
