import { describe, expect, it } from 'vitest';
import { buildOutfitNofacePath, getOutfitNofacePath, isValidMascotAssetId } from '../mascot-noface';

describe('mascot-noface', () => {
    it('buildOutfitNofacePath_衣装IDごとのnofaceパスを生成すること', () => {
        expect(buildOutfitNofacePath('mascot_1', 'outfit-2')).toBe(
            '/mascots/users/usr_local_dev_bypass/mascot_1/outfits/outfit-2/noface.png'
        );
    });

    it('buildOutfitNofacePath_不正なIDを拒否すること', () => {
        expect(() => buildOutfitNofacePath('mascot_1', '../outfit')).toThrow();
        expect(isValidMascotAssetId('outfit_1')).toBe(true);
        expect(isValidMascotAssetId('../outfit')).toBe(false);
    });

    it('getOutfitNofacePath_衣装に保存されたパスだけを返すこと', () => {
        expect(getOutfitNofacePath({ id: 'outfit-1', nofacePath: '/outfits/outfit-1/noface.png' }))
            .toBe('/outfits/outfit-1/noface.png');
        expect(getOutfitNofacePath({ id: 'outfit-2' })).toBeNull();
    });
});
