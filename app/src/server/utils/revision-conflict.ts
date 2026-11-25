/**
 * 楽観的ロック（リビジョン不一致）によるデータ更新競合エラー。
 */
export class DataRevisionConflictError<T = unknown> extends Error {
    readonly statusCode = 409;
    readonly currentRevision: number;
    readonly latestData: T;

    constructor(message: string, currentRevision: number, latestData: T) {
        super(message);
        this.name = 'DataRevisionConflictError';
        this.currentRevision = currentRevision;
        this.latestData = latestData;
    }
}

/**
 * 保存済み JSON から有効な非負整数リビジョンを取り出す。
 */
export function normalizeRevision(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
