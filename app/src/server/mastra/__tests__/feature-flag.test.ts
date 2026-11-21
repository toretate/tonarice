import { describe, expect, it } from 'vitest';
import { isMastraChatEnabled } from '../feature-flag';

describe('isMastraChatEnabledのテスト', () => {
    it('isMastraChatEnabled_未指定なら既定で有効にすること', () => {
        expect(isMastraChatEnabled({})).toBe(true);
    });
    it.each(['1', 'true', ' TRUE '])(
        'isMastraChatEnabled_%sの場合は有効と判定すること',
        (value) => {
            expect(isMastraChatEnabled({ MASTRA_CHAT_ENABLED: value })).toBe(true);
        }
    );

    it.each(['', ' ', '0', 'false', ' FALSE ', 'yes', 'enabled'])(
        'isMastraChatEnabled_%sの場合は無効と判定すること',
        (value) => {
            expect(isMastraChatEnabled({ MASTRA_CHAT_ENABLED: value })).toBe(false);
        }
    );
});
