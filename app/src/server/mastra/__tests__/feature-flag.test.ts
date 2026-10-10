import { describe, expect, it } from 'vitest';
import { isMastraChatEnabled } from '../feature-flag';

describe('isMastraChatEnabledのテスト', () => {
    it.each(['1', 'true', ' TRUE '])(
        'isMastraChatEnabled_%sの場合は有効と判定すること',
        (value) => {
            expect(isMastraChatEnabled({ MASTRA_CHAT_ENABLED: value })).toBe(true);
        }
    );

    it.each([undefined, '', '0', 'false', 'yes', 'enabled'])(
        'isMastraChatEnabled_%sの場合は無効と判定すること',
        (value) => {
            expect(isMastraChatEnabled({ MASTRA_CHAT_ENABLED: value })).toBe(false);
        }
    );
});
