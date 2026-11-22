import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prepareIsolatedStorage, resolveDevNuxtOptions } from './dev-nuxt-options.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const processFile = path.join(projectDir, 'node_modules', '.cache', 'tonarice', 'dev-nuxt.json');

let resolved;
try {
    resolved = prepareIsolatedStorage(resolveDevNuxtOptions(process.argv.slice(2), projectDir, process.env));
} catch (error) {
    console.error(`[DevNuxt] ${error instanceof Error ? error.message : '起動オプションが不正です。'}`);
    process.exit(2);
}

const nuxtArguments = ['nuxt', 'dev', ...resolved.nuxtArgs];

if (resolved.isolatedStorage) {
    console.log(`[DevNuxt] 隔離ストレージを使用します: ${resolved.isolatedStorage.dir}`);
}

if (resolved.trackProcessFile) {
    fs.mkdirSync(path.dirname(processFile), { recursive: true });
    fs.writeFileSync(processFile, JSON.stringify({ pid: process.pid }), 'utf8');
}

const removeProcessFile = () => {
    if (!resolved.trackProcessFile) return;
    try {
        const tracked = JSON.parse(fs.readFileSync(processFile, 'utf8'));
        if (tracked.pid === process.pid) fs.rmSync(processFile, { force: true });
    } catch {
        // 記録が存在しない場合は何もしない。
    }
};

let cleanedIsolatedDir = false;
const cleanupIsolatedStorage = () => {
    if (cleanedIsolatedDir || !resolved.isolatedStorage?.autoCleanup) return;
    cleanedIsolatedDir = true;
    try {
        fs.rmSync(resolved.isolatedStorage.dir, { recursive: true, force: true });
    } catch {
        // 一時ディレクトリの削除に失敗しても終了処理は継続する。
    }
};

const cleanupAll = () => {
    removeProcessFile();
    cleanupIsolatedStorage();
};

const nuxtProcess = spawn('npx', nuxtArguments, {
    cwd: projectDir,
    env: resolved.childEnv,
    shell: true,
    stdio: 'inherit'
});

nuxtProcess.on('close', (exitCode) => {
    cleanupAll();
    process.exit(exitCode ?? 0);
});

process.on('SIGINT', () => {
    cleanupAll();
    process.exit(130);
});

process.on('SIGTERM', () => {
    cleanupAll();
    process.exit(143);
});

process.on('exit', cleanupAll);
