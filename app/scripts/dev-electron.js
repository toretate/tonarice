import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDevServerListening, waitForDevServer } from './dev-electron-readiness.js';
import { resolveNuxtCommand, terminateProcessTree } from './dev-nuxt-lifecycle.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const processFile = path.join(projectRoot, 'node_modules', '.cache', 'tonarice', 'dev-electron.json');
const devServerUrl = new URL('http://localhost:3000/');

function writeProcessFile() {
    fs.mkdirSync(path.dirname(processFile), { recursive: true });
    fs.writeFileSync(processFile, JSON.stringify({ pid: process.pid }), 'utf8');
}

function removeProcessFile() {
    try {
        const tracked = JSON.parse(fs.readFileSync(processFile, 'utf8'));
        if (tracked.pid === process.pid) fs.rmSync(processFile, { force: true });
    } catch {
        // 記録が存在しない場合は何もしない。
    }
}

// プロセスツリーを確実に強制終了する関数 (Windows対策)
function killProcess(childProcess) {
    if (!childProcess) return;
    if (process.platform === 'win32') {
        exec(`taskkill /pid ${childProcess.pid} /T /F`, (err) => {
            // エラーログは通常不要なので無視
        });
    } else {
        childProcess.kill();
    }
}

// Nuxt サーバーが起動しているか確認し、起動していなければ自動で立ち上げる
async function ensureNuxt(url) {
    let nuxtProcess = null;
    const startup = new AbortController();
    if (await isDevServerListening(url)) {
        console.log('[DevElectron] Checking the server already listening on port 3000.');
    } else {
        console.log('[DevElectron] Nuxt dev server is not running. Starting it now...');
        const { command, args, useShell } = resolveNuxtCommand(projectRoot, []);
        nuxtProcess = spawn(command, args, {
            cwd: projectRoot,
            shell: useShell,
            stdio: 'inherit'
        });
        nuxtProcess.once('error', error => startup.abort(error));
        nuxtProcess.once('exit', (code, signal) => {
            startup.abort(new Error(`Nuxt 開発サーバーが終了しました (${signal ?? code})。`));
        });
    }

    try {
        await waitForDevServer(url, { childSignal: startup.signal });
        return nuxtProcess;
    } catch (error) {
        if (nuxtProcess?.exitCode === null && nuxtProcess.signalCode === null) {
            await terminateProcessTree(nuxtProcess.pid);
        }
        throw error;
    }
}

async function start() {
    writeProcessFile();
    let nuxtProcess = null;
    console.log('[DevElectron] Checking Nuxt dev server status...');
    try {
        nuxtProcess = await ensureNuxt(devServerUrl);
        console.log('[DevElectron] Nuxt dev server is ready! Building main process...');
    } catch (error) {
        console.error(`[DevElectron] ${error.message}`);
        process.exit(1);
    }

    // tsup で electron メインプロセスのビルド & ウォッチを開始
    console.log('[DevElectron] Starting tsup watch for Electron scripts...');
    const tsup = spawn('npx', ['tsup', '--watch'], {
        cwd: projectRoot,
        shell: true,
        stdio: 'inherit'
    });

    // 少し待ってから Electron を起動
    setTimeout(() => {
        console.log('[DevElectron] Launching Electron...');
        const electronProcess = spawn('npx', ['electron', '.'], {
            cwd: projectRoot,
            shell: true,
            stdio: 'inherit',
            env: {
                ...process.env,
                VITE_DEV_SERVER_URL: devServerUrl.href
            }
        });

        electronProcess.on('close', () => {
            console.log('[DevElectron] Electron closed. Stopping watch processes...');
            killProcess(tsup);
            if (nuxtProcess) {
                console.log('[DevElectron] Stopping Nuxt dev server...');
                killProcess(nuxtProcess);
            }
            removeProcessFile();
            process.exit(0);
        });
    }, 3000);
}

process.on('exit', removeProcessFile);

start();
