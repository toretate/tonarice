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
        await menu.handle('/mascot'); await menu.handle('p'); await menu.handle('丁寧な話し方');
        assert.equal(menu.config().systemPrompt, '丁寧な話し方');
        assert.equal(menu.config().activeMascotId, 'm1');
        assert.equal(history.length, 0);
    });

    it('handle_新規作成し選択する', async () => {
        const client = { list: async () => [], activeId: async () => '', update: async request => ({ id: 'new', name: request.name }) };
        const menu = createMascotMenu({ chatConfig: { engine: 'lmstudio' } }, { write() {} }, [], { client });
        await menu.handle('/mascot'); await menu.handle('c'); await menu.handle('新しい子');
        assert.equal(menu.config().activeMascotId, 'new');
    });
});
