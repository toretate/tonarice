import { defineNitroPlugin } from 'nitropack/runtime';
import { getCoWorkScope } from '../cowork/http';
import { getCoWorkRepository } from '../cowork/runtime';
import { dispatchNextCoWorkRun, ensureQueueRecoverySchedule, requeueUndeliveredCoWorkRun } from '../cowork/mastra-queue';
import { reconcileCoWorkSchedules } from '../cowork/mastra-schedules';
import { getMastraRuntime, getMastraShutdownSignal, stopMastraRuntime } from '../mastra/runtime';

export default defineNitroPlugin(async nitro => {
    const mastra = getMastraRuntime();
    const signal = getMastraShutdownSignal();
    const repository = getCoWorkRepository();
    nitro.hooks.hook('close', async () => {
        stopMastraRuntime();
        requeueUndeliveredCoWorkRun(mastra, repository);
        await mastra.stopWorkers({ drainTimeout: 5_000 });
    });
    for (const { owner } of repository.listAllTasks()) {
        repository.registerOwnerScope(owner, getCoWorkScope(owner));
    }

    try {
        await mastra.startWorkers();
        repository.recoverExpiredRuns();
        await reconcileCoWorkSchedules(mastra, repository, signal);
        await ensureQueueRecoverySchedule(mastra, repository, signal);
        await dispatchNextCoWorkRun(mastra, repository, signal);
    } catch {
        console.error('[CoWork] Mastra scheduler を初期化できませんでした。');
    }
});
