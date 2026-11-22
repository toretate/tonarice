import { createMascotClient } from './mascots.js';

export function createMascotMenu(options, output, history, dependencies = {}) {
    const client = dependencies.client || createMascotClient(options);
    let current = null;
    let items = [];
    let state = '';
    let engine = '';
    function select(mascot) {
        if (current?.id !== mascot.id) history.length = 0;
        current = mascot;
        output.write(`選択中: ${mascot.name} (${mascot.id})\n`);
    }
    async function ensureCurrent() {
        if (current) return true;
        items = await client.list();
        if (!items.length) { output.write('マスコットがありません。/mascot から作成してください。\n'); return false; }
        const activeId = await client.activeId();
        select(items.find(item => item.id === activeId) || items[0]);
        return true;
    }
    return {
        reset() { current = null; items = []; state = ''; history.length = 0; },
        config() {
            if (!current) return options.chatConfig;
            return { ...options.chatConfig, engine: current.aiConfig?.chat?.engine || options.chatConfig.engine, model: current.aiConfig?.chat?.model || options.chatConfig.model, systemPrompt: current.profile || options.chatConfig.systemPrompt, activeMascotId: current.id };
        },
        async handle(line) {
            if (line === '/cancel' && state) { state = ''; output.write('操作をキャンセルしました。\n'); return true; }
            if (state === 'mascot') {
                state = '';
                if (line === 'c') { state = 'name'; output.write('新しいマスコットの名前を入力してください（/cancel で中止）: '); }
                else if (line === 'p') { if (await ensureCurrent()) { state = 'profile'; output.write('性格・プロフィールを１行で入力してください（/cancel で中止）: '); } }
                else if (/^[1-9][0-9]*$/.test(line) && items[Number(line) - 1]) select(items[Number(line) - 1]);
                else output.write('選択肢が不正です。\n');
                return true;
            }
            if (state === 'name') { state = ''; if (line) select(await client.update({ action: 'create', name: line })); return true; }
            if (state === 'profile') { state = ''; current = await client.update({ action: 'profile', id: current.id, profile: line }); history.length = 0; output.write('性格設定を保存しました。\n'); return true; }
            if (state === 'engine') { if (!['1', '2', '3'].includes(line)) { output.write('1〜3 を入力してください（/cancel で中止）: '); return true; } engine = { 1: 'lmstudio', 2: 'openai', 3: 'gemini' }[line]; state = 'model'; output.write('モデル ID を入力してください（/cancel で中止）: '); return true; }
            if (state === 'model') { if (!line) { output.write('モデル ID を入力してください: '); return true; } state = ''; current = await client.update({ action: 'model', id: current.id, engine, model: line }); output.write(`保存しました: ${engine} / ${line}\n`); return true; }
            if (line === '/mascot') {
                items = await client.list();
                if (!current && items.length) {
                    const activeId = await client.activeId();
                    current = items.find(item => item.id === activeId) || items[0];
                }
                output.write(`マスコット一覧\n${items.map((item, index) => `${index + 1}: ${item.name}${current?.id === item.id ? '（選択中）' : ''}`).join('\n')}\nc: 作成  p: 選択中の性格設定  /cancel: 中止\n番号または操作を入力: `);
                state = 'mascot'; return true;
            }
            if (line === '/model') {
                if (await ensureCurrent()) { output.write(`現在: ${current.aiConfig?.chat?.engine || '未設定'} / ${current.aiConfig?.chat?.model || '未設定'}\n1: lmstudio  2: openai  3: gemini（/cancel で中止）\n番号を入力: `); state = 'engine'; }
                return true;
            }
            return false;
        }
    };
}
