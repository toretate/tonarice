import { randomUUID } from 'node:crypto';
import { CliError } from './main.js';

export function createGuiContext(client, options, output) {
    let mascotId = '';
    let sessionId = '';
    let sessions = [];
    let lastId = 1;
    let menuActive = false;
    let newSessionRequested = false;

    async function load(mascot, announce = true) {
        const result = await client.history(mascot.id);
        if (result.enabled !== true || !Array.isArray(result.sessions)) throw new CliError('server_error', '会話履歴を取得できませんでした。', 6);
        mascotId = mascot.id;
        sessions = result.sessions;
        const startNew = newSessionRequested;
        sessionId = startNew ? randomUUID() : sessions[0]?.id || randomUUID();
        newSessionRequested = false;
        lastId = Math.max(1, ...sessions.flatMap(session => (session.messages || []).map(item => Number.isSafeInteger(item.id) ? item.id : 1)));
        if (announce) output.write(sessions.length && !startNew ? `会話「${sessions[0].title}」を選択しました。/history で切り替えできます。\n` : '新しい会話を開始します。\n');
    }
    return {
        cancel() { if (!menuActive) return false; menuActive = false; return true; },
        reset() { mascotId = ''; sessionId = ''; sessions = []; menuActive = false; newSessionRequested = false; },
        newSession() { if (!mascotId) newSessionRequested = true; else sessionId = randomUUID(); output.write('新しい会話を開始します。\n'); },
        async handle(line, mascot) {
            if (menuActive) {
                menuActive = false;
                if (line === '/cancel') { output.write('操作をキャンセルしました。\n'); return true; }
                const chosen = sessions[Number(line) - 1];
                if (!/^[1-9][0-9]*$/.test(line) || !chosen) { output.write('選択肢が不正です。\n'); return true; }
                sessionId = chosen.id;
                output.write(`会話「${chosen.title}」を選択しました。\n`);
                for (const item of (chosen.messages || []).slice(-10)) output.write(`${item.sender === 'user' ? 'あなた' : 'マスコット'}: ${item.text}\n`);
                return true;
            }
            if (line !== '/history') return false;
            const previousSessionId = mascotId === mascot.id ? sessionId : '';
            await load(mascot, false);
            if (previousSessionId) sessionId = previousSessionId;
            if (!sessions.length) { output.write('保存済みの会話はありません。\n'); return true; }
            output.write(`保存済みの会話\n${sessions.map((item, i) => `${i + 1}: ${item.title}`).join('\n')}\n番号を入力（/cancel で中止）: `);
            menuActive = true;
            return true;
        },
        async prepare(mascot, modelOverride, privateMode = false) {
            if (!mascot?.id) throw new CliError('invalid_input', 'マスコットを選択してください。', 2);
            if (!privateMode && mascotId !== mascot.id) await load(mascot);
            const config = await client.config();
            const explicit = options.explicit || [];
            const engine = explicit.includes('--engine') ? options.chatConfig.engine : modelOverride ? mascot.aiConfig?.chat?.engine : config.selectedEngine || mascot.aiConfig?.chat?.engine || 'gemini';
            if (!['lmstudio', 'openai', 'gemini'].includes(engine)) throw new CliError('invalid_input', 'GUI のチャットエンジンは CLI で使用できません。', 2);
            const defaultModels = { openai: 'gpt-4o', gemini: 'gemini-1.5-flash', lmstudio: '' };
            const model = explicit.includes('--model') ? options.chatConfig.model : modelOverride ? mascot.aiConfig?.chat?.model : config[`${engine}Model`] || mascot.aiConfig?.chat?.model || defaultModels[engine];
            const customPrompt = explicit.includes('--system-prompt');
            const chatMode = customPrompt ? (privateMode ? 'secret_cli_override' : 'cli_override') : (privateMode ? 'secret' : 'normal');
            lastId = Math.max(Date.now(), lastId + 1);
            const userId = lastId;
            lastId++;
            return {
                payload: { engine, model, promptVersion: 1, chatMode, ...(customPrompt ? { systemPrompt: options.chatConfig.systemPrompt } : {}), activeMascotId: mascot.id, ...(!privateMode ? { memorySessionId: sessionId, memoryUserMessageId: userId, memoryAssistantMessageId: lastId } : {}),
                    lmstudioEndpoint: explicit.includes('--lmstudio-endpoint') ? options.chatConfig.lmstudioEndpoint : config.lmstudioEndpoint,
                    temperature: config.temperature, frequencyPenalty: config.frequencyPenalty, repetitionPenalty: config.repetitionPenalty, maxOutputTokens: config.maxOutputTokens, enableThinking: config.enableThinking },
                apiKey: engine === 'gemini' ? config.googleAiStudioApiKey : engine === 'openai' ? config.openaiApiKey : ''
            };
        }
    };
}
