import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimMutation } from '../mutation-claim';
import { requestToolApproval, respondToolApproval } from '../tool-approval';

describe('ツール操作の安全性', () => {
    it('requestToolApproval_別の操作を直列表示し待機中は承認期限を消費しないこと', async () => {
        vi.useFakeTimers();
        try {
            const peer = { send: vi.fn() };
            const signal = new AbortController().signal;
            const first = requestToolApproval(peer, 'manageMemos', { action: 'add', content: 'A' }, signal);
            const second = requestToolApproval(peer, 'manageMemos', { action: 'add', content: 'B' }, signal);
            const requests = () => peer.send.mock.calls.map(([value]) => JSON.parse(value)).filter(event => event.event === 'tool-approval-request');
            expect(requests()).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(40000);
            respondToolApproval(peer, requests()[0].data.id, true);
            expect(await first).toBe(true);
            expect(requests()).toHaveLength(2);
            await vi.advanceTimersByTimeAsync(40000);
            respondToolApproval(peer, requests()[1].data.id, true);
            expect(await second).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('requestToolApproval_切断時は表示中と待機中を両方拒否すること', async () => {
        const peer = { send: vi.fn() };
        const controller = new AbortController();
        const first = requestToolApproval(peer, 'manageTasks', { action: 'add', title: 'A' }, controller.signal);
        const second = requestToolApproval(peer, 'manageTasks', { action: 'add', title: 'B' }, controller.signal);
        controller.abort();
        expect(await Promise.all([first, second])).toEqual([false, false]);
        expect(peer.send.mock.calls.filter(([value]) => JSON.parse(value).event === 'tool-approval-request')).toHaveLength(1);
    });
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
