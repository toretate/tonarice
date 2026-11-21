import { afterEach, describe, expect, it } from 'vitest';
import pingHandler from '../api/ping';
import { resetMastraRuntimeForTest } from '../mastra/runtime';

describe('pingHandlerのテスト', () => {
    afterEach(() => {
        resetMastraRuntimeForTest();
    });

    it('pingHandler_Mastraを初期化せず有効状態を返すこと', async () => {
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
