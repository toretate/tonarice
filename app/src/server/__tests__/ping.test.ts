import { afterEach, describe, expect, it } from 'vitest';
import pingHandler from '../api/ping';
import { resetMastraRuntimeForTest } from '../mastra/runtime';

describe('pingHandlerのテスト', () => {
    const originalFeatureFlag = process.env.MASTRA_CHAT_ENABLED;

    afterEach(() => {
        if (originalFeatureFlag === undefined) {
            delete process.env.MASTRA_CHAT_ENABLED;
        } else {
            process.env.MASTRA_CHAT_ENABLED = originalFeatureFlag;
        }
        resetMastraRuntimeForTest();
    });

    it('pingHandler_未指定時にMastraを初期化せず既定の有効状態を返すこと', async () => {
        delete process.env.MASTRA_CHAT_ENABLED;

        const response = await pingHandler({} as never);

        expect(response).toMatchObject({
            success: true,
            message: 'pong',
            mastra: {
                enabled: true,
                initialized: false
            }
        });
    });

    it('pingHandler_明示的な無効化を反映すること', async () => {
        process.env.MASTRA_CHAT_ENABLED = 'false';
        const response = await pingHandler({} as never);
        expect(response.mastra).toEqual({ enabled: false, initialized: false });
    });
});
