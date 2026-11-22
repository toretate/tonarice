import { CliError, assertIsolatedServer, parseArgs, run } from './main.js';
import { chatSend } from './chat.js';
import { interactive } from './interactive.js';

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '-p' || rawArgs[0] === '--print'
    ? ['chat', 'send', ...rawArgs.slice(1)]
    : rawArgs.length === 0 || rawArgs[0].startsWith('--')
        ? ['chat', 'interactive', ...rawArgs]
        : rawArgs;

if (args[0] === 'chat' && args[1] === 'interactive') {
    try {
        const options = parseArgs(args);
        if (options.isolated) await assertIsolatedServer(options);
        process.exitCode = await interactive(options);
    } catch (error) {
        process.stderr.write(`${error instanceof CliError ? error.message : 'CLI の処理に失敗しました。'}\n`);
        process.exitCode = error instanceof CliError ? error.exitCode : 6;
    }
} else {
    let input;
    if (args[0] === 'chat' && args[1] === 'send') {
        let text = '';
        process.stdin.setEncoding('utf8');
        for await (const chunk of process.stdin) {
            text += chunk;
            if (text.length > 1024 * 1024) break;
        }
        input = text;
    }
    const { output, exitCode } = await run(args, fetch, input, chatSend);
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exitCode = exitCode;
}
