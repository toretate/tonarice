import { describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage, type PersistentStorageManager } from '../storage-persistence';

describe('requestPersistentStorage', () => {
    it('すでに永続化済みの場合は再要求しないこと', async () => {
        const storageManager = {
            persisted: vi.fn().mockResolvedValue(true),
            persist: vi.fn().mockResolvedValue(true)
        };

        await expect(requestPersistentStorage(storageManager)).resolves.toBe(true);
        expect(storageManager.persist).not.toHaveBeenCalled();
    });

    it('未永続化の場合はブラウザへ永続化を要求すること', async () => {
        const storageManager = {
            persisted: vi.fn().mockResolvedValue(false),
            persist: vi.fn().mockResolvedValue(true)
        };

        await expect(requestPersistentStorage(storageManager)).resolves.toBe(true);
        expect(storageManager.persist).toHaveBeenCalledOnce();
    });

    it('Storage APIが利用できない場合はfalseを返すこと', async () => {
        await expect(requestPersistentStorage({} as PersistentStorageManager)).resolves.toBe(false);
    });

    it('ブラウザが要求を拒否しても例外にしないこと', async () => {
        const storageManager = {
            persisted: vi.fn().mockResolvedValue(false),
            persist: vi.fn().mockRejectedValue(new Error('denied'))
        };

        await expect(requestPersistentStorage(storageManager)).resolves.toBe(false);
    });
});
