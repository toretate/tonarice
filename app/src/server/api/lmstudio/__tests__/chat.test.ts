import { describe, expect, it, vi } from 'vitest';
import { readBody } from 'h3';
import handler from '../chat.post';
import { MastraChatService } from '../../../mastra/mastra-chat-service';

vi.mock('h3', async importOriginal => ({
    ...await importOriginal<typeof import('h3')>(),
    readBody: vi.fn()
}));
vi.mock('../../../mastra/mastra-chat-service', () => ({
    MastraChatService: { generateResponse: vi.fn() }
}));

describe('LM Studio対話APIのテスト', () => {
    it('handler_既存の応答形式を保ちMastraで生成すること', async () => {
        vi.mocked(readBody).mockResolvedValue({ message: 'こんにちは', modelName: 'local-model' });
        vi.mocked(MastraChatService.generateResponse).mockResolvedValue('応答');
        expect(await handler({} as never)).toEqual({ success: true, response: '応答' });
        expect(MastraChatService.generateResponse).toHaveBeenCalledWith(expect.objectContaining({
            engine: 'lmstudio', modelId: 'local-model', message: 'こんにちは'
        }));
    });
});
