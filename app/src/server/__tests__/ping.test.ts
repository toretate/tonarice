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

    it('pingHandler_Mastraを初期化せず有効状態を返すこと', async () => {
        process.env.MASTRA_CHAT_ENABLED = 'true';

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
});
