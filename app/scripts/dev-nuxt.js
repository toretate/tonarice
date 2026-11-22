import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertPortAvailable,
    prepareIsolatedStorage,
    resolveDevNuxtOptions
} from './dev-nuxt-options.js';
import { resolveNuxtCommand, runManagedChild } from './dev-nuxt-lifecycle.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const processFile = path.join(projectDir, 'node_modules', '.cache', 'tonarice', 'dev-nuxt.json');

async function main() {
    let resolved;
    try {
        resolved = resolveDevNuxtOptions(process.argv.slice(2), projectDir, process.env);
        if (resolved.isolatedStorage && resolved.port !== null) {
            await assertPortAvailable(resolved.port, resolved.host);
        }
        resolved = prepareIsolatedStorage(resolved);
    } catch (error) {
        console.error(`[DevNuxt] ${error instanceof Error ? error.message : '起動オプションが不正です。'}`);
        process.exit(2);
    }

    if (resolved.isolatedStorage) {
        console.log(`[DevNuxt] 隔離ストレージを使用します (port: ${resolved.port}): ${resolved.isolatedStorage.dir}`);
    }

    const launch = resolveNuxtCommand(projectDir, resolved.nuxtArgs);
    const exitCode = await runManagedChild({
        command: launch.command,
        args: launch.args,
        cwd: projectDir,
        env: resolved.childEnv,
        useShell: launch.useShell,
        trackProcessFile: resolved.trackProcessFile,
        processFile,
        isolatedStorage: resolved.isolatedStorage
    });
    process.exit(exitCode);
}

void main();
