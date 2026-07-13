export interface OutfitWithNoface {
    id: string;
    nofacePath?: string;
}

const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidMascotAssetId(value: string): boolean {
    return ASSET_ID_PATTERN.test(value);
}

export function buildOutfitNofacePath(
    mascotId: string,
    outfitId: string,
    userId = 'usr_local_dev_bypass'
): string {
    if (![mascotId, outfitId, userId].every(isValidMascotAssetId)) {
        throw new Error('mascotId, outfitId, and userId must contain only letters, numbers, underscores, or hyphens');
    }

    return `/mascots/users/${userId}/${mascotId}/outfits/${outfitId}/noface.png`;
}

export function getOutfitNofacePath(outfit: OutfitWithNoface | null | undefined): string | null {
    const path = outfit?.nofacePath?.trim();
    return path || null;
}
