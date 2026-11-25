import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runManagedChild, terminateProcessTree } from './dev-nuxt-lifecycle.js';

describe('dev-nuxt-lifecycle', () => {
    it('runManagedChild_SIGTERM受信時に子プロセスのclose完了を待ってから隔離領域を削除する', async () => {
        const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-lifecycle-order-'));
        const fakeSignalTarget = new EventEmitter();
        const fakeChild = new EventEmitter();
        fakeChild.pid = 424242;

        let terminateCalledWith = null;
        let dirExistedDuringTerminate = false;
        let dirExistedBeforeClose = false;

        const exitPromise = runManagedChild({
            command: process.execPath,
            args: ['-e', ''],
            cwd: process.cwd(),
            env: process.env,
            isolatedStorage: { dir: isoDir, autoCleanup: true },
            signalTarget: fakeSignalTarget,
            spawnFn: () => fakeChild,
            terminateFn: async (pid, signal) => {
                terminateCalledWith = { pid, signal };
                dirExistedDuringTerminate = fs.existsSync(isoDir);
            }
        });

        fakeSignalTarget.emit('SIGTERM');
        await new Promise((resolve) => setImmediate(resolve));

        dirExistedBeforeClose = fs.existsSync(isoDir);
        assert.deepEqual(terminateCalledWith, { pid: 424242, signal: 'SIGTERM' });
        assert.equal(dirExistedDuringTerminate, true);
        assert.equal(dirExistedBeforeClose, true);

        // 子プロセスの close が発火した後に初めて隔離領域が削除されること
        fakeChild.emit('close', 0);
        const exitCode = await exitPromise;
        assert.equal(exitCode, 143);
        assert.equal(fs.existsSync(isoDir), false);
    });

    it('runManagedChild_実子プロセスと孫プロセスを終了してから隔離保存先を削除する', async () => {
        const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-lifecycle-real-'));
        const readyFile = path.join(isoDir, 'ready.txt');
        const grandchildPidFile = path.join(isoDir, 'grandchild.pid');
        const fakeSignalTarget = new EventEmitter();

        const childScript = `
            const fs = require('node:fs');
            const { spawn } = require('node:child_process');
            const grand = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
            fs.writeFileSync(${JSON.stringify(grandchildPidFile)}, String(grand.pid));
            fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
            setInterval(() => {}, 1000);
        `;

        const exitPromise = runManagedChild({
            command: process.execPath,
            args: ['-e', childScript],
            cwd: process.cwd(),
            env: process.env,
            isolatedStorage: { dir: isoDir, autoCleanup: true },
            signalTarget: fakeSignalTarget
        });

        const deadline = Date.now() + 5000;
        while (!fs.existsSync(readyFile) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(fs.existsSync(readyFile), true);
        const grandchildPid = Number(fs.readFileSync(grandchildPidFile, 'utf8').trim());
        assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);

        fakeSignalTarget.emit('SIGINT');
        const exitCode = await exitPromise;
        assert.equal(exitCode, 130);
        assert.equal(fs.existsSync(isoDir), false);

        // 孫プロセスも終了していること（終了処理の反映を短時間待つ）
        let stillAlive = true;
        const killDeadline = Date.now() + 3000;
        while (Date.now() < killDeadline) {
            try {
                process.kill(grandchildPid, 0);
                await new Promise((resolve) => setTimeout(resolve, 50));
            } catch {
                stillAlive = false;
                break;
            }
        }
        assert.equal(stillAlive, false);
    });

    it('terminateProcessTree_WindowsではtaskkillをTとF付きで呼び出す', async () => {
        const calls = [];
        const fakeSpawn = (cmd, args, opts) => {
            calls.push({ cmd, args, opts });
            const emitter = new EventEmitter();
            queueMicrotask(() => emitter.emit('close', 0));
            return emitter;
        };
        await terminateProcessTree(99999, 'SIGTERM', 'win32', fakeSpawn);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].cmd, 'taskkill');
        assert.deepEqual(calls[0].args, ['/pid', '99999', '/T', '/F']);
    });
});
