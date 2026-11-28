import { defineNitroPlugin } from 'nitropack/runtime';
import { getChatDatabasePath } from '../mastra/chat-sequence';
import { getMemoryStore } from '../mastra/memory-store';
import { runLearningOnce } from '../mastra/learning-jobs';

export default defineNitroPlugin(nitro => {
    const controller = new AbortController();
    let work: Promise<void> | undefined;
    const tick = () => {
        if (work || controller.signal.aborted) return;
        work = (async () => {
            const path = await getChatDatabasePath(getMemoryStore().memory);
            if (path && !controller.signal.aborted) await runLearningOnce(path, controller.signal);
        })().catch(() => console.warn('[記憶] 遅延抽出のスケジューラで処理に失敗しました。')).finally(() => { work = undefined; });
    };
    const timer = setInterval(tick, 5000);
    timer.unref();
    const stop = async () => {
        clearInterval(timer);
        controller.abort();
        if (!work) return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([work, new Promise<void>(resolve => { timeout = setTimeout(resolve, 1500); })]);
        } finally { clearTimeout(timeout); }
    };
    const onMessage = (message: unknown) => {
        if (message !== 'tonarice-stop-learning') return;
        void stop().then(() => process.send?.('tonarice-learning-stopped'));
    };
    if (process.send) process.on('message', onMessage);
    nitro.hooks.hook('close', async () => {
        process.off('message', onMessage);
        await stop();
    });
});
