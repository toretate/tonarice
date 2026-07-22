export type PersistentStorageManager = Pick<StorageManager, 'persist' | 'persisted'>;

export const requestPersistentStorage = async (
    storageManager: PersistentStorageManager | undefined = typeof navigator !== 'undefined'
        ? navigator.storage
        : undefined,
): Promise<boolean> => {
    if (!storageManager?.persist || !storageManager.persisted) return false;

    try {
        if (await storageManager.persisted()) return true;
        return await storageManager.persist();
    } catch (error) {
        console.warn('[PWA] 永続ストレージの要求に失敗しました。', error);
        return false;
    }
};
