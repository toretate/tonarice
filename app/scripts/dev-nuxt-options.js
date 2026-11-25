import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * ポート番号文字列を検証し、1〜65535 の整数として返す。
 */
export function parsePortValue(rawValue, label = 'ポート番号') {
    const trimmed = String(rawValue ?? '').trim();
    if (!/^[0-9]+$/.test(trimmed)) {
        throw new Error(`${label}は 1〜65535 の整数で指定してください。`);
    }
    const port = Number(trimmed);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${label}が範囲外です（1〜65535）。`);
    }
    return port;
}

/**
 * 環境変数から既定のサーバーポートを解決する。未指定時は null を返す。
 */
export function resolveServerPort(env = process.env) {
    const rawPort = (env?.TONARICE_PORT ?? env?.PORT ?? '').trim();
    if (!rawPort) return null;
    const label = env?.TONARICE_PORT?.trim() ? '環境変数 TONARICE_PORT' : '環境変数 PORT';
    return parsePortValue(rawPort, label);
}

/**
 * dev-nuxt.js への引数と環境変数から Nuxt 起動構成を組み立てる。
 */
export function resolveDevNuxtOptions(argv, projectDir, env = process.env) {
    const nuxtArgs = [];
    let explicitPort = null;
    let host = null;
    let isolatedMode = false;
    let isolatedPathArg = '';

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--isolated-storage') {
            if (isolatedMode) {
                throw new Error('--isolated-storage は複数回指定できません。');
            }
            isolatedMode = true;
            const next = argv[index + 1];
            if (next !== undefined && !next.startsWith('-')) {
                isolatedPathArg = next.trim();
                if (!isolatedPathArg) {
                    throw new Error('--isolated-storage に空のパスは指定できません。');
                }
                index++;
            }
            continue;
        }
        if (arg.startsWith('--isolated-storage=')) {
            if (isolatedMode) {
                throw new Error('--isolated-storage は複数回指定できません。');
            }
            isolatedMode = true;
            isolatedPathArg = arg.slice('--isolated-storage='.length).trim();
            if (!isolatedPathArg) {
                throw new Error('--isolated-storage に空のパスは指定できません。');
            }
            continue;
        }
        if (arg === '--port' || arg === '-p') {
            const next = argv[index + 1];
            if (next === undefined || next.startsWith('-')) {
                throw new Error(`${arg} にはポート番号を指定してください。`);
            }
            explicitPort = parsePortValue(next, `引数 ${arg}`);
            nuxtArgs.push(arg, String(explicitPort));
            index++;
            continue;
        }
        if (arg.startsWith('--port=') || arg.startsWith('-p=')) {
            const eqIndex = arg.indexOf('=');
            const flag = arg.slice(0, eqIndex);
            explicitPort = parsePortValue(arg.slice(eqIndex + 1), `引数 ${flag}`);
            nuxtArgs.push(`${flag}=${explicitPort}`);
            continue;
        }
        if (arg === '--host' || arg === '-H') {
            const next = argv[index + 1];
            if (next !== undefined && !next.startsWith('-')) {
                host = next.trim() || null;
                nuxtArgs.push(arg, next);
                index++;
                continue;
            }
        } else if (arg.startsWith('--host=')) {
            host = arg.slice('--host='.length).trim() || null;
        }
        nuxtArgs.push(arg);
    }

    const childEnv = { ...env, TONARICE_ISOLATED_SERVER: '0' };
    let port = explicitPort;
    if (port === null) {
        port = resolveServerPort(env);
        if (port !== null) {
            nuxtArgs.push('--port', String(port));
        }
    }

    if (isolatedMode && port === null) {
        throw new Error('隔離ストレージ起動時はポートの明示指定が必要です（--port <ポート> または環境変数 TONARICE_PORT / PORT）。');
    }

    if (port !== null) {
        childEnv.PORT = String(port);
        childEnv.NITRO_PORT = String(port);
    }

    let isolatedStorage = null;
    if (isolatedMode) {
        if (isolatedPathArg) {
            const dir = path.resolve(projectDir, isolatedPathArg);
            isolatedStorage = { dir, autoCleanup: false };
        } else {
            isolatedStorage = { dir: '', autoCleanup: true };
        }
    }

    return {
        nuxtArgs,
        port,
        host,
        childEnv,
        isolatedStorage,
        trackProcessFile: !isolatedMode
    };
}

function probeSingleHost(port, host) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', (error) => {
            if (host === '::1' && (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')) {
                resolve();
                return;
            }
            if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
                reject(new Error(`指定されたポート ${port} は既に使用中です。別ポートへ自動移動せず起動を中止します。`));
                return;
            }
            reject(error);
        });
        server.listen({ port, host, exclusive: true }, () => {
            server.close((closeErr) => {
                if (closeErr) reject(closeErr);
                else resolve();
            });
        });
    });
}

/**
 * 指定ポートが使用中でないことを事前に検証する。
 * 使用中の場合は別ポートへの自動フォールバックを防ぐためエラーを投げる。
 */
export async function assertPortAvailable(port, host = null) {
    const hosts = !host || host === 'localhost'
        ? ['127.0.0.1', '::1']
        : host === '0.0.0.0' || host === '::'
            ? [host, '127.0.0.1']
            : [host];
    for (const candidate of hosts) {
        await probeSingleHost(port, candidate);
    }
}

/**
 * 隔離ストレージ用ディレクトリを作成し、子プロセス環境変数へ設定する。
 */
export function prepareIsolatedStorage(options) {
    if (!options.isolatedStorage) return options;
    const dir = options.isolatedStorage.autoCleanup
        ? fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-isolated-storage-'))
        : options.isolatedStorage.dir;
    fs.mkdirSync(dir, { recursive: true });
    return {
        ...options,
        isolatedStorage: {
            ...options.isolatedStorage,
            dir
        },
        childEnv: {
            ...options.childEnv,
            MASCOT_STORAGE_DIR: dir,
            TONARICE_ISOLATED_SERVER: '1'
        }
    };
}
