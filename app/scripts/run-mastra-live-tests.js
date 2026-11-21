import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const vitestPath = path.join(projectDir, 'node_modules', 'vitest', 'vitest.mjs');
const testPath = 'src/server/mastra/__tests__/mastra-chat-service.live.test.ts';

// 外部APIを呼ぶテストは専用コマンドからだけ明示的に有効化する。
const testProcess = spawn(process.execPath, [
    vitestPath, 'run', '--config', 'vitest.mastra.config.ts', testPath
], {
    cwd: projectDir,
    env: {
        ...process.env,
        MASTRA_LIVE_TEST: '1'
    },
    stdio: 'inherit'
});

testProcess.on('error', () => {
    console.error('Mastra実接続テストを開始できませんでした。');
    process.exit(1);
});

testProcess.on('close', (exitCode) => {
    process.exit(exitCode ?? 1);
});
