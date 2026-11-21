import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimMutation } from '../mutation-claim';
import { requestToolApproval, respondToolApproval } from '../tool-approval';

describe('ツール操作の安全性', () => {
    it('requestToolApproval_同じ接続の承認のみ受け付けること', async () => {
        const peer = { send: vi.fn() };
        const other = { send: vi.fn() };
        const promise = requestToolApproval(peer, 'manageTasks', { action: 'delete', id: 'task-1' }, new AbortController().signal);
        const request = JSON.parse(peer.send.mock.calls[0][0]);
        respondToolApproval(other, request.data.id, true);
        respondToolApproval(peer, request.data.id, true);
        expect(await promise).toBe(true);
    });

    it('requestToolApproval_接続終了や拒否では承認しないこと', async () => {
        const peer = { send: vi.fn() };
        const controller = new AbortController();
        const promise = requestToolApproval(peer, 'manageMemos', { action: 'add' }, controller.signal);
        controller.abort();
        expect(await promise).toBe(false);
    });

    it('requestToolApproval_時間切れは拒否し遅れて届く承認を無視すること', async () => {
        vi.useFakeTimers();
        try {
            const peer = { send: vi.fn() };
            const promise = requestToolApproval(peer, 'manageMemos', { action: 'delete', id: 'memo-1' }, new AbortController().signal);
            const request = JSON.parse(peer.send.mock.calls[0][0]);
            await vi.advanceTimersByTimeAsync(45000);
            expect(await promise).toBe(false);
            respondToolApproval(peer, request.data.id, true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('claimMutation_再起動後も同一発話の同一変更を再実行せず別ユーザーと区別すること', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tonarice-claims-'));
        try {
            expect(claimMutation(dir, 'u1', 't1', 'manageTasks', { action: 'add', title: '会議' })).toBe(true);
            expect(claimMutation(dir, 'u1', 't1', 'manageTasks', { title: '会議', action: 'add' })).toBe(false);
            expect(claimMutation(dir, 'u2', 't1', 'manageTasks', { action: 'add', title: '会議' })).toBe(true);
            expect(claimMutation(dir, 'u1', 't2', 'manageTasks', { action: 'add', title: '会議' })).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
