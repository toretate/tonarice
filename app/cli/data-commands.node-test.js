import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDataCommand } from './data-commands.js';

describe('メモとタスク', () => {
    it('handleDataCommand_一覧を表示し追加と完了を個別操作で送る', async () => {
        let output = '';
        const requests = [];
        const client = {
            listData: async kind => kind === 'memo' ? { memos: [{ id: 'm1', content: 'メモ' }] } : { tasks: [{ id: 't1', title: 'タスク', completed: false }] },
            updateData: async body => { requests.push(body); return { success: true, id: body.id || 'new' }; }
        };
        const stream = { write(value) { output += value; } };
        await handleDataCommand('/memo', client, stream);
        await handleDataCommand('/todo list', client, stream);
        await handleDataCommand('/memo add 買い物', client, stream);
        await handleDataCommand('/todo done t1', client, stream);
        assert.match(output, /m1: メモ/);
        assert.match(output, /t1: \[未\] タスク/);
        assert.deepEqual(requests, [{ kind: 'memo', action: 'add', text: '買い物' }, { kind: 'todo', action: 'update', id: 't1', completed: true }]);
    });

    it('handleDataCommand_不正な操作を送信しない', async () => {
        let calls = 0;
        const client = { updateData: async () => { calls++; } };
        assert.equal(await handleDataCommand('/memo delete', client, { write() {} }), true);
        assert.equal(await handleDataCommand('普通の対話', client, { write() {} }), false);
        assert.equal(calls, 0);
    });
});
