/** Irodori-TTSが受け付ける再生速度の最小値です。 */
export const IRODORI_SPEED_MIN = 0.25;

/** Irodori-TTSが受け付ける再生速度の最大値です。 */
export const IRODORI_SPEED_MAX = 4.0;

/** Irodori-TTSの標準再生速度です。 */
export const IRODORI_SPEED_DEFAULT = 1.0;

/** 設定値をIrodori-TTSの有効な再生速度へ正規化します。 */
export function normalizeIrodoriSpeed(value: unknown): number {
    if (value === undefined || value === null || value === '') {
        return IRODORI_SPEED_DEFAULT;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return IRODORI_SPEED_DEFAULT;
    }

    return Math.min(IRODORI_SPEED_MAX, Math.max(IRODORI_SPEED_MIN, numericValue));
}
