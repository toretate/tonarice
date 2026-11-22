import { createInterface } from 'node:readline';
import { chatSend, resolveApiKey } from './chat.js';
import { CliError, parseOrigin } from './main.js';
import { createMascotMenu } from './mascot-menu.js';
import { login } from './login.js';
import { createMascotClient } from './mascots.js';
import { createGuiContext } from './gui-context.js';
import { handleDataCommand } from './data-commands.js';

const help = '/login: ログイン  /model: モデル設定  /mascot: マスコット設定  /history: 会話選択  /private: 非保存会話  /memo: メモ  /todo: タスク  /help: ヘルプ  /clear: 新しい会話  /exit または /quit: 終了';

export async function interactive(options, dependencies = {}) {
    parseOrigin(options.url);
    const input = dependencies.input || process.stdin;
    const output = dependencies.output || process.stdout;
    const errors = dependencies.errors || process.stderr;
    const send = dependencies.send || chatSend;
    const controller = new AbortController();
    const terminal = Boolean(input.isTTY && output.isTTY);
    const lines = createInterface({ input, output, terminal, prompt: '> ' });
    const history = [];
    const env = { ...(dependencies.env || process.env) };
    const client = dependencies.client || createMascotClient(options, { ...dependencies, env });
    const menu = createMascotMenu(options, output, history, { ...dependencies, env, client });
    const context = dependencies.context || createGuiContext(client, options, output);
    let interrupted = false;
    let activeTurn;
    let privateMode = false;
    const onKeypress = (value, key) => {
        if (key?.name !== 'escape' || key.sequence !== '\u001b') return;
        if (activeTurn && !activeTurn.signal.aborted) {
            activeTurn.abort();
        } else if (menu.cancel() || context.cancel()) {
            lines.write(null, { ctrl: true, name: 'u' });
            output.write('\n操作をキャンセルしました。\n');
            lines.prompt();
        }
    };
    const onInterrupt = () => {
        interrupted = true;
        controller.abort();
        lines.close();
    };
    lines.on('SIGINT', onInterrupt);
    if (terminal) input.on('keypress', onKeypress);
    process.on('SIGINT', onInterrupt);
    output.write(`対話を開始します（${options.chatConfig.engine}）。${help}\n`);
    if (terminal) lines.prompt();
    try {
        for await (const line of lines) {
            if (menu.isEditingProfile()) {
                try { await menu.handle(line); }
                catch (error) { errors.write(`${error instanceof CliError ? error.message : '性格設定を保存できませんでした。もう一度お試しください。'}\n`); }
                if (terminal && !interrupted) lines.prompt();
                continue;
            }
            const message = line.trim();
            if (message === '/exit' || message === '/quit') break;
            if (message === '/help') output.write(`${help}\n`);
            else if (message === '/clear') {
                history.length = 0;
                if (privateMode) output.write('プライベート会話を新しく開始します。\n');
                else context.newSession();
            }
            else if (message) {
                try {
                    if (message === '/login') {
                        activeTurn = new AbortController();
                        let token;
                        try {
                            token = await (dependencies.login || login)(options, output, { signal: AbortSignal.any([controller.signal, activeTurn.signal]) });
                        } finally { activeTurn = undefined; }
                        if (interrupted) break;
                        env.TONARICE_SESSION_TOKEN = token;
                        menu.reset();
                        context.reset();
                        history.length = 0;
                        privateMode = false;
                        output.write('ログインしました。\n');
                        if (terminal) lines.prompt();
                        continue;
                    }
                    if (await menu.handle(message)) { if (terminal && !interrupted) lines.prompt(); continue; }
                    if (message === '/private') {
                        privateMode = !privateMode;
                        context.cancel();
                        history.length = 0;
                        output.write(privateMode ? 'プライベート会話を開始しました。会話履歴は保存されません。\n' : '通常会話に戻りました。プライベート会話の内容は破棄しました。\n');
                        if (terminal) lines.prompt();
                        continue;
                    }
                    if (await handleDataCommand(message, client, output)) { if (terminal && !interrupted) lines.prompt(); continue; }
                    if (privateMode && message === '/history') { output.write('プライベート会話では保存済み履歴を使用しません。/private で通常会話に戻れます。\n'); if (terminal) lines.prompt(); continue; }
                    if (!await menu.ensureCurrent()) { if (terminal && !interrupted) lines.prompt(); continue; }
                    if (await context.handle(message, menu.getCurrent())) { if (terminal && !interrupted) lines.prompt(); continue; }
                    const prepared = await context.prepare(menu.getCurrent(), menu.hasModelOverride(), privateMode);
                    const requestEnv = { ...env, TONARICE_AI_API_KEY: resolveApiKey(prepared.payload.engine, env, prepared.apiKey) };
                    activeTurn = new AbortController();
                    let result;
                    try {
                        result = await send(options, JSON.stringify({ ...prepared.payload, ...(privateMode ? { history: history.slice(-10) } : {}), message }), { signal: AbortSignal.any([controller.signal, activeTurn.signal]), env: requestEnv });
                    } finally { activeTurn = undefined; }
                    if (interrupted) break;
                    history.push({ sender: 'user', text: message }, { sender: 'mascot', text: result.text });
                    if (history.length > 10) history.splice(0, history.length - 10);
                    output.write(`マスコット: ${result.text}\n`);
                } catch (error) {
                    if (interrupted) break;
                    errors.write(`${error instanceof CliError ? error.message : '対話処理に失敗しました。'}\n`);
                }
            }
            if (terminal && !interrupted) lines.prompt();
        }
    } finally {
        process.removeListener('SIGINT', onInterrupt);
        if (terminal) input.removeListener('keypress', onKeypress);
        lines.close();
    }
    return interrupted ? 130 : 0;
}
