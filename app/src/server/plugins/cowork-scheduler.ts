import { defineNitroPlugin } from 'nitropack/runtime';
import { getCoWorkRepository, runCoWorkOnce } from '../cowork/runtime';

export default defineNitroPlugin((nitro) => {
    const stopping = new AbortController();
    let current: Promise<void> | undefined;
    let nextPruneAt = 0;
    const tick = () => {
        if (current || stopping.signal.aborted) return;
        current = Promise.resolve()
            .then(() => {
                if (stopping.signal.aborted) return;
                const repository = getCoWorkRepository();
                if (Date.now() >= nextPruneAt) {
                    repository.pruneExpiredHistory();
                    nextPruneAt = Date.now() + 3_600_000;
                }
                return runCoWorkOnce(repository, stopping.signal);
            })
            .catch(() => console.error('[CoWork] スケジュールを処理できませんでした。'))
            .finally(() => { current = undefined; });
    };
    const timer = setInterval(tick, 2_000);
    timer.unref();
    tick();
    nitro.hooks.hook('close', async () => {
        clearInterval(timer);
        stopping.abort();
        await current;
    });
});
