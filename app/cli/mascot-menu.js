import { createMascotClient } from './mascots.js';

export function createMascotMenu(options, output, history, dependencies = {}) {
    const client = dependencies.client || createMascotClient(options);
    let current = null;
    let items = [];
    let state = '';
    let engine = '';
    let modelChanged = false;
    let profileDraft = [];
    function select(mascot) {
        if (current?.id !== mascot.id) history.length = 0;
        if (current?.id !== mascot.id) modelChanged = false;
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
        cancel() { if (!state) return false; state = ''; profileDraft = []; return true; },
        reset() { current = null; items = []; state = ''; modelChanged = false; profileDraft = []; history.length = 0; },
        isEditingProfile() { return state === 'profile'; },
        async ensureCurrent() { return ensureCurrent(); },
        getCurrent() { return current; },
        hasModelOverride() { return modelChanged; },
        config() {
            if (!current) return options.chatConfig;
            return { ...options.chatConfig, engine: current.aiConfig?.chat?.engine || options.chatConfig.engine, model: current.aiConfig?.chat?.model || options.chatConfig.model, systemPrompt: current.profile || options.chatConfig.systemPrompt, activeMascotId: current.id };
        },
        async handle(line) {
            if (line === '/cancel' && state) { state = ''; profileDraft = []; output.write('操作をキャンセルしました。\n'); return true; }
            if (state === 'mascot') {
                state = '';
                if (line === 'c') { state = 'name'; output.write('新しいマスコットの名前を入力してください（/cancel または Esc で中止）。\n'); }
                else if (line === 'p') {
                    if (await ensureCurrent()) {
                        state = 'profile';
                        profileDraft = [];
                        output.write(`「${current.name}」の現在の性格・プロフィール:\n${current.profile || '（未設定）'}\n`);
                        output.write('新しい内容を複数行で入力し、/save で保存します。空にする場合は /empty、変更しない場合は /cancel または Esc を使用してください。\n');
                    }
                }
                else if (/^[1-9][0-9]*$/.test(line) && items[Number(line) - 1]) select(items[Number(line) - 1]);
                else output.write('選択肢が不正です。\n');
                return true;
            }
            if (state === 'name') { state = ''; if (line) select(await client.update({ action: 'create', name: line })); return true; }
            if (state === 'profile') {
                if (line !== '/save' && line !== '/empty') {
                    const next = [...profileDraft, line];
                    if (next.join('\n').length > 20000) output.write('プロフィールは 20000 文字以内で入力してください。\n');
                    else profileDraft = next;
                    return true;
                }
                const profile = line === '/empty' ? '' : profileDraft.join('\n');
                if (line === '/save' && !profile.trim()) { output.write('内容を入力してください。空にする場合は /empty を使用してください。\n'); return true; }
                current = await client.update({ action: 'profile', id: current.id, profile });
                state = '';
                profileDraft = [];
                history.length = 0;
                output.write('性格設定を保存しました。\n');
                return true;
            }
            if (state === 'engine') { if (!['1', '2', '3'].includes(line)) { output.write('1〜3 を入力してください（/cancel または Esc で中止）。\n'); return true; } engine = { 1: 'lmstudio', 2: 'openai', 3: 'gemini' }[line]; state = 'model'; output.write('モデル ID を入力してください（/cancel または Esc で中止）。\n'); return true; }
            if (state === 'model') { if (!line) { output.write('モデル ID を入力してください。\n'); return true; } state = ''; current = await client.update({ action: 'model', id: current.id, engine, model: line }); modelChanged = true; output.write(`保存しました: ${engine} / ${line}\n`); return true; }
            if (line === '/mascot') {
                items = await client.list();
                if (!current && items.length) {
                    const activeId = await client.activeId();
                    current = items.find(item => item.id === activeId) || items[0];
                }
                output.write(`マスコット一覧\n${items.map((item, index) => `${index + 1}: ${item.name}${current?.id === item.id ? '（選択中）' : ''}`).join('\n')}\nc: 作成  p: 選択中の性格設定  /cancel または Esc: 中止\n番号または操作を入力してください。\n`);
                state = 'mascot'; return true;
            }
            if (line === '/model') {
                if (await ensureCurrent()) { output.write(`現在: ${current.aiConfig?.chat?.engine || '未設定'} / ${current.aiConfig?.chat?.model || '未設定'}\n1: lmstudio  2: openai  3: gemini（/cancel または Esc で中止）\n番号を入力してください。\n`); state = 'engine'; }
                return true;
            }
            return false;
        }
    };
}
