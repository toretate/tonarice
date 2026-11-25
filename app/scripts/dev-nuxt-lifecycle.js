import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Nuxt 開発サーバーの起動コマンドを解決する。
 * 直接 node で nuxt.mjs を起動できる場合は shell を介さず起動する。
 */
export function resolveNuxtCommand(projectDir, nuxtArgs) {
    const nuxtBin = path.join(projectDir, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs');
    if (fs.existsSync(nuxtBin)) {
        return {
            command: process.execPath,
            args: [nuxtBin, 'dev', ...nuxtArgs],
            useShell: false
        };
    }
    return {
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['nuxt', 'dev', ...nuxtArgs],
        useShell: process.platform === 'win32'
    };
}

/**
 * 子プロセスツリーを確実に終了する（Windows は taskkill /T /F、非 Windows はプロセスグループ終了）。
 */
export function terminateProcessTree(pid, signal = 'SIGTERM', platform = process.platform, spawnFn = spawn) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve();
    if (platform === 'win32') {
        return new Promise((resolve) => {
            const killer = spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true
            });
            killer.once('error', () => resolve());
            killer.once('close', () => resolve());
        });
    }
    try {
        process.kill(-pid, signal);
    } catch {
        try {
            process.kill(pid, signal);
        } catch {
            // 既に終了済みの場合は何もしない。
        }
    }
    return Promise.resolve();
}

function removeProcessFileIfOwner(processFile, pid) {
    if (!processFile) return;
    try {
        const tracked = JSON.parse(fs.readFileSync(processFile, 'utf8'));
        if (tracked.pid === pid) fs.rmSync(processFile, { force: true });
    } catch {
        // 記録が存在しない場合は何もしない。
    }
}

function removeIsolatedDirSafely(dir) {
    if (!dir) return;
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
        // 一時ディレクトリの削除に失敗しても終了処理は継続する。
    }
}

/**
 * 子プロセスを起動し、SIGINT/SIGTERM 受信時は子プロセスツリーの close を待ってから
 * PID ファイルと隔離ストレージの後処理を行う。
 */
export function runManagedChild({
    command,
    args,
    cwd,
    env,
    useShell = false,
    trackProcessFile = false,
    processFile = '',
    isolatedStorage = null,
    spawnFn = spawn,
    terminateFn = terminateProcessTree,
    forceKillTimeoutMs = 5000,
    ownerPid = process.pid,
    signalTarget = process
}) {
    if (trackProcessFile && processFile) {
        fs.mkdirSync(path.dirname(processFile), { recursive: true });
        fs.writeFileSync(processFile, JSON.stringify({ pid: ownerPid }), 'utf8');
    }

    let cleaned = false;
    let childClosed = false;
    let shuttingDown = false;
    let signalExitCode = null;
    let forceKillTimer = null;

    const cleanupAfterChildClosed = () => {
        if (cleaned || !childClosed) return;
        cleaned = true;
        if (trackProcessFile) {
            removeProcessFileIfOwner(processFile, ownerPid);
        }
        if (isolatedStorage?.autoCleanup) {
            removeIsolatedDirSafely(isolatedStorage.dir);
        }
    };

    const child = spawnFn(command, args, {
        cwd,
        env,
        shell: useShell,
        stdio: 'inherit',
        detached: process.platform !== 'win32'
    });

    const handleSignal = (signal) => {
        signalExitCode = signal === 'SIGINT' ? 130 : 143;
        if (shuttingDown) return;
        shuttingDown = true;
        void terminateFn(child.pid, signal);
        if (process.platform !== 'win32' && forceKillTimeoutMs > 0) {
            forceKillTimer = setTimeout(() => {
                if (!childClosed) {
                    void terminateFn(child.pid, 'SIGKILL');
                }
            }, forceKillTimeoutMs);
            forceKillTimer.unref?.();
        }
    };

    const onSigint = () => handleSignal('SIGINT');
    const onSigterm = () => handleSignal('SIGTERM');
    signalTarget.on('SIGINT', onSigint);
    signalTarget.on('SIGTERM', onSigterm);

    const detachSignals = () => {
        if (forceKillTimer) {
            clearTimeout(forceKillTimer);
            forceKillTimer = null;
        }
        signalTarget.removeListener('SIGINT', onSigint);
        signalTarget.removeListener('SIGTERM', onSigterm);
    };

    return new Promise((resolve) => {
        child.once('error', () => {
            childClosed = true;
            detachSignals();
            cleanupAfterChildClosed();
            resolve(1);
        });

        child.once('close', (exitCode) => {
            childClosed = true;
            detachSignals();
            cleanupAfterChildClosed();
            resolve(signalExitCode ?? exitCode ?? 0);
        });
    });
}
