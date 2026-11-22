import { createInterface } from 'node:readline';
import { chatSend } from './chat.js';
import { CliError, parseOrigin } from './main.js';
import { createMascotMenu } from './mascot-menu.js';
import { login } from './login.js';

const help = '/login: ログイン  /model: モデル設定  /mascot: マスコット設定  /help: ヘルプ  /clear: 会話を消去  /exit または /quit: 終了';

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
    const menu = createMascotMenu(options, output, history, { ...dependencies, env });
    let interrupted = false;
    const onInterrupt = () => {
        interrupted = true;
        controller.abort();
        lines.close();
    };
    lines.on('SIGINT', onInterrupt);
    process.on('SIGINT', onInterrupt);
    output.write(`対話を開始します（${options.chatConfig.engine}）。${help}\n`);
    if (terminal) lines.prompt();
    try {
        for await (const line of lines) {
            const message = line.trim();
            if (message === '/exit' || message === '/quit') break;
            if (message === '/help') output.write(`${help}\n`);
            else if (message === '/clear') { history.length = 0; output.write('会話の文脈を消去しました。\n'); }
            else if (message) {
                try {
                    if (message === '/login') {
                        const token = await (dependencies.login || login)(options, output, { signal: controller.signal });
                        if (interrupted) break;
                        env.TONARICE_SESSION_TOKEN = token;
                        menu.reset();
                        output.write('ログインしました。\n');
                        if (terminal) lines.prompt();
                        continue;
                    }
                    if (await menu.handle(message)) { if (terminal && !interrupted) lines.prompt(); continue; }
                    const result = await send(options, JSON.stringify({ ...menu.config(), message, history: history.slice(-10) }), { signal: controller.signal, env });
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
        lines.close();
    }
    return interrupted ? 130 : 0;
}
