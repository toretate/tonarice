import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMascotMenu } from './mascot-menu.js';

describe('マスコットメニュー', () => {
    it('handle_選択中のマスコットにモデルと性格を設定する', async () => {
        let mascot = { id: 'm1', name: 'ミカ', profile: '明るい', aiConfig: { chat: { engine: 'lmstudio', model: 'old' } } };
        const history = [{ sender: 'user', text: '前の話' }];
        const client = {
            list: async () => [mascot], activeId: async () => 'm1',
            update: async request => {
                mascot = request.action === 'model'
                    ? { ...mascot, aiConfig: { chat: { engine: request.engine, model: request.model } } }
                    : { ...mascot, profile: request.profile };
                return mascot;
            }
        };
        const menu = createMascotMenu({ chatConfig: { engine: 'lmstudio' } }, { write() {} }, history, { client });
        await menu.handle('/model'); await menu.handle('2'); await menu.handle('gpt-example');
        assert.equal(menu.config().model, 'gpt-example');
        await menu.handle('/mascot'); await menu.handle('p'); await menu.handle('丁寧な話し方'); await menu.handle('/save');
        assert.equal(menu.config().systemPrompt, '丁寧な話し方');
        assert.equal(menu.config().activeMascotId, 'm1');
        assert.equal(history.length, 0);
    });

    it('handle_現在の性格を表示し複数行を保存して空行と字下げを維持する', async () => {
        let text = '';
        const saves = [];
        const mascot = { id: 'm1', name: 'ミカ', profile: '現在の性格' };
        const client = { list: async () => [mascot], activeId: async () => 'm1', update: async request => { saves.push(request); return { ...mascot, profile: request.profile }; } };
        const menu = createMascotMenu({ chatConfig: {} }, { write(value) { text += value; } }, [], { client });
        await menu.handle('/mascot'); await menu.handle('p');
        assert.match(text, /現在の性格/);
        assert.match(text, /\/save/);
        await menu.handle('明るい'); await menu.handle(''); await menu.handle('  丁寧');
        assert.equal(saves.length, 0);
        await menu.handle('/save');
        assert.equal(saves[0].profile, '明るい\n\n  丁寧');
        assert.equal(menu.isEditingProfile(), false);
    });

    it('handle_保存失敗時に入力を保持しキャンセル時は保存しない', async () => {
        let calls = 0;
        const mascot = { id: 'm1', name: 'ミカ', profile: '既存' };
        const client = { list: async () => [mascot], activeId: async () => 'm1', update: async request => { calls++; if (calls === 1) throw new Error('error'); return { ...mascot, profile: request.profile }; } };
        const menu = createMascotMenu({ chatConfig: {} }, { write() {} }, [], { client });
        await menu.handle('/mascot'); await menu.handle('p'); await menu.handle('新しい性格');
        await assert.rejects(menu.handle('/save'));
        assert.equal(menu.isEditingProfile(), true);
        await menu.handle('/save');
        assert.equal(menu.config().systemPrompt, '新しい性格');
        await menu.handle('/mascot'); await menu.handle('p'); await menu.handle('破棄する内容');
        assert.equal(menu.cancel(), true);
        assert.equal(calls, 2);
    });

    it('handle_新規作成し選択する', async () => {
        const client = { list: async () => [], activeId: async () => '', update: async request => ({ id: 'new', name: request.name }) };
        const menu = createMascotMenu({ chatConfig: { engine: 'lmstudio' } }, { write() {} }, [], { client });
        await menu.handle('/mascot'); await menu.handle('c'); await menu.handle('新しい子');
        assert.equal(menu.config().activeMascotId, 'new');
    });
});
