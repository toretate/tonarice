import { onMounted, onUnmounted } from 'vue';

export function useCoWorkPolling(refresh: (signal: AbortSignal) => Promise<void>, delay = 10_000) {
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mounted = false;

    const stop = () => {
        clearTimeout(timer);
        request?.abort();
        request = undefined;
    };

    const reload = async () => {
        stop();
        if (!mounted || document.hidden) return;
        const active = new AbortController();
        request = active;
        try {
            await refresh(active.signal);
        } finally {
            if (request === active) {
                request = undefined;
                timer = setTimeout(() => { void reload(); }, delay);
            }
        }
    };

    const onVisibility = () => { void reload(); };
    onMounted(() => {
        mounted = true;
        document.addEventListener('visibilitychange', onVisibility);
        void reload();
    });
    onUnmounted(() => {
        mounted = false;
        stop();
        document.removeEventListener('visibilitychange', onVisibility);
    });
    return reload;
}
