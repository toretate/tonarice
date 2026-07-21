import { onMounted, onUnmounted, ref } from 'vue';

export const SMARTPHONE_LAYOUT_QUERY = '(max-width: 768px) and (hover: none) and (pointer: coarse)';

export const useSmartphoneLayout = () => {
    const isSmartphoneLayout = ref(false);
    let mediaQuery: MediaQueryList | null = null;

    const update = (event: MediaQueryListEvent | MediaQueryList) => {
        isSmartphoneLayout.value = event.matches;
    };

    onMounted(() => {
        if (typeof window.matchMedia !== 'function') return;
        mediaQuery = window.matchMedia(SMARTPHONE_LAYOUT_QUERY);
        update(mediaQuery);
        mediaQuery.addEventListener('change', update);
    });

    onUnmounted(() => {
        mediaQuery?.removeEventListener('change', update);
    });

    return { isSmartphoneLayout };
};
