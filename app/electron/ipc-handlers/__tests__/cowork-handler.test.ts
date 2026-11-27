import { describe, expect, it, vi } from 'vitest';
import { isCoWorkRequestAllowed, resolveCoWorkOrigin } from '../cowork-handler';

vi.mock('electron', () => ({ ipcMain: {}, shell: {} }));

describe('CoWork Electron IPC', () => {
    it('resolveCoWorkOrigin_共有サーバーをHTTPSに限定する', () => {
        const local = new URL('http://localhost:3000/#chat');
        expect(resolveCoWorkOrigin(local)).toBe('http://localhost:3000');
        expect(resolveCoWorkOrigin(local, 'https://cowork.example.test')).toBe('https://cowork.example.test');
        expect(() => resolveCoWorkOrigin(local, 'http://192.168.1.2:3000')).toThrow();
        expect(() => resolveCoWorkOrigin(local, 'https://cowork.example.test/other')).toThrow();
    });

    it('isCoWorkRequestAllowed_CoWork以外のパスと余分なメソッドを拒否する', () => {
        const path = '/tasks/4f943375-814c-40a5-828a-cf3d0584958b/run';
        expect(isCoWorkRequestAllowed({ path, method: 'POST' })).toBe(true);
        expect(isCoWorkRequestAllowed({ path, method: 'GET' })).toBe(false);
        expect(isCoWorkRequestAllowed({ path: '/../auth/status', method: 'GET' })).toBe(false);
        expect(isCoWorkRequestAllowed({ path: '/pair', method: 'POST' })).toBe(false);
        expect(isCoWorkRequestAllowed({ path: '/settings', method: 'GET' })).toBe(true);
        expect(isCoWorkRequestAllowed({ path: '/settings', method: 'PUT' })).toBe(true);
        expect(isCoWorkRequestAllowed({ path: '/settings', method: 'DELETE' })).toBe(true);
        expect(isCoWorkRequestAllowed({ path: '/settings', method: 'POST' })).toBe(false);
        expect(isCoWorkRequestAllowed({ path: '/models', method: 'POST' })).toBe(true);
        expect(isCoWorkRequestAllowed({ path: '/models', method: 'GET' })).toBe(false);
    });
});
