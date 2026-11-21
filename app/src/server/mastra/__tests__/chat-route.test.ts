import { describe, expect, it } from 'vitest';
import { getMastraChatErrorMessage } from '../chat-route';

describe('getMastraChatErrorMessageのテスト', () => {
    it('getMastraChatErrorMessage_API応答本文と認証情報を表示しないこと', () => {
        const error = new Error('request failed sk-test-sensitive');
        const message = getMastraChatErrorMessage(error, 'openai');

        expect(message).toContain('OpenAI'.toLowerCase());
        expect(message).not.toContain('sk-test-sensitive');
        expect(message).not.toContain('request failed');
    });

    it('getMastraChatErrorMessage_未設定のAPIキーは設定案内を返すこと', () => {
        const error = new Error('OpenAI API KEYが設定されていません。sk-test-sensitive');
        const message = getMastraChatErrorMessage(error, 'openai');
        expect(message).toContain('OpenAI API KEYが設定されていません');
        expect(message).not.toContain('sk-test-sensitive');
    });

    it('getMastraChatErrorMessage_入れ子のテンプレートエラーを安全な案内に変換すること', () => {
        const error = { lastError: { responseBody: 'Error rendering prompt with jinja template: secret-value' } };
        const message = getMastraChatErrorMessage(error, 'lmstudio');
        expect(message).toContain('テンプレート');
        expect(message).toContain('ツール使用を無効');
        expect(message).not.toContain('secret-value');
        expect(getMastraChatErrorMessage(error, 'gemini')).not.toContain('テンプレート');
    });
});
