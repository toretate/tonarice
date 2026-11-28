import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGuiContext } from './gui-context.js';

describe('GUI の設定と履歴', () => {
    it('prepare_GUIのマスコット設定と最新会話を使用する', async () => {
        const client = {
            history: async () => ({ enabled: true, sessions: [{ id: 'latest', title: '会話', messages: [{ id: 123, sender: 'user', text: '過去' }] }] }),
            config: async () => ({ selectedEngine: 'gemini', geminiModel: 'gui-model', googleAiStudioApiKey: 'secret', temperature: 0.4 }),
            prompts: async () => ({ prompts: { soul: '親切' } })
        };
        const context = createGuiContext(client, { chatConfig: { engine: 'lmstudio' }, explicit: [] }, { write() {} });
        const first = await context.prepare({ id: 'm1', profile: '元気' }, false);
        const second = await context.prepare({ id: 'm1', profile: '元気' }, false);
        assert.equal(first.payload.engine, 'gemini');
        assert.equal(first.payload.model, 'gui-model');
        assert.equal(first.payload.memorySessionId, 'latest');
        assert.equal(first.payload.promptVersion, 1);
        assert.equal(first.payload.chatMode, 'normal');
        assert.equal(first.payload.systemPrompt, undefined);
        assert.equal(first.apiKey, 'secret');
        assert.ok(second.payload.memoryUserMessageId > first.payload.memoryAssistantMessageId);
    });

    it('handle_保存済みの会話を選択し以降の発話に利用する', async () => {
        const client = {
            history: async () => ({ enabled: true, sessions: [{ id: 'new', title: '新しい', messages: [] }, { id: 'old', title: '古い', messages: [{ id: 100, sender: 'user', text: '前の話' }] }] }),
            config: async () => ({}), prompts: async () => ({ prompts: {} })
        };
        let output = '';
        const context = createGuiContext(client, { chatConfig: { engine: 'lmstudio' }, explicit: [] }, { write(text) { output += text; } });
        const mascot = { id: 'm1', aiConfig: { chat: { engine: 'lmstudio' } } };
        await context.handle('/history', mascot);
        await context.handle('2', mascot);
        assert.match(output, /前の話/);
        assert.equal((await context.prepare(mascot, false)).payload.memorySessionId, 'old');
        await context.handle('/history', mascot);
        assert.equal(context.cancel(), true);
        assert.equal((await context.prepare(mascot, false)).payload.memorySessionId, 'old');
        context.newSession();
        assert.notEqual((await context.prepare(mascot, false)).payload.memorySessionId, 'old');
    });
});
