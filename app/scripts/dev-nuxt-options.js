import fs from 'node:fs';
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
    let hasPortArg = false;
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
        if (arg === '--port' || arg === '-p' || arg.startsWith('--port=')) {
            hasPortArg = true;
        }
        nuxtArgs.push(arg);
    }

    const childEnv = { ...env };
    let port = null;
    if (!hasPortArg) {
        port = resolveServerPort(env);
        if (port !== null) {
            nuxtArgs.push('--port', String(port));
            childEnv.PORT = String(port);
            childEnv.NITRO_PORT = String(port);
        }
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
        childEnv,
        isolatedStorage,
        trackProcessFile: !isolatedMode
    };
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
            MASCOT_STORAGE_DIR: dir
        }
    };
}
