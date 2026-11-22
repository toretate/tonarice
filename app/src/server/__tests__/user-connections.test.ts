import { describe, expect, it, vi } from 'vitest';
import { addUserConnection, removeUserConnection, broadcastToUser } from '../utils/user-connections';

describe('ユーザー別接続', () => {
    it('broadcastToUser_同じ利用者の接続だけへ通知し切断済み接続を無視する', () => {
        const bad = { send: vi.fn(() => { throw new Error('closed'); }) };
        const peer = { send: vi.fn() };
        const other = { send: vi.fn() };
        addUserConnection('u1', bad); addUserConnection('u1', peer); addUserConnection('u2', other);
        try {
            broadcastToUser('u1', 'memo-action', { id: 'm1' });
            expect(peer.send).toHaveBeenCalledWith(JSON.stringify({ event: 'memo-action', data: { id: 'm1' } }));
            expect(other.send).not.toHaveBeenCalled();
        } finally { removeUserConnection('u1', bad); removeUserConnection('u1', peer); removeUserConnection('u2', other); }
    });
});
