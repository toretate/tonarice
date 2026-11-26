import { defineNitroPlugin } from 'nitropack/runtime';
import { getCoWorkScope } from '../cowork/http';
import { getCoWorkRepository } from '../cowork/runtime';
import { dispatchNextCoWorkRun, reconcileCoWorkSchedules } from '../cowork/mastra-schedules';
import { getMastraRuntime, stopMastraRuntime } from '../mastra/runtime';

export default defineNitroPlugin(async nitro => {
    const mastra = getMastraRuntime();
    const repository = getCoWorkRepository();
    for (const { owner } of repository.listAllTasks()) {
        repository.registerOwnerScope(owner, getCoWorkScope(owner));
    }

    try {
        await mastra.startWorkers();
        await reconcileCoWorkSchedules(mastra, repository);
        await dispatchNextCoWorkRun(mastra, repository);
    } catch {
        console.error('[CoWork] Mastra scheduler を初期化できませんでした。');
    }

    nitro.hooks.hook('close', async () => {
        stopMastraRuntime();
        await mastra.stopWorkers({ drainTimeout: 5_000 });
    });
});
