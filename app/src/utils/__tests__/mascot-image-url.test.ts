import { describe, expect, it } from 'vitest';
import { resolveMascotImageUrl } from '../mascot-image-url';

describe('resolveMascotImageUrl', () => {
    it('アセット単位の版数クエリを保持して絶対URLへ変換すること', () => {
        expect(resolveMascotImageUrl('/mascots/users/user/mascot/outfits/body.png?v=asset-2', {
            serverHost: '127.0.0.1',
            serverPort: 3000,
            absoluteMascotUrl: true
        })).toBe('http://127.0.0.1:3000/mascots/users/user/mascot/outfits/body.png?v=asset-2');
    });

    it('Data URLとBlob URLは変更しないこと', () => {
        const options = { serverHost: 'localhost', serverPort: 3000, absoluteMascotUrl: true };
        expect(resolveMascotImageUrl('data:image/png;base64,abc', options)).toBe('data:image/png;base64,abc');
        expect(resolveMascotImageUrl('blob:http://localhost/image', options)).toBe('blob:http://localhost/image');
    });
});
