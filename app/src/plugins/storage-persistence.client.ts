import { defineNuxtPlugin } from 'nuxt/app';
import { requestPersistentStorage } from '../utils/storage-persistence';

const isWebClient = (): boolean => {
    return typeof window.electronAPI === 'undefined';
};

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.hook('app:mounted', () => {
        if (!isWebClient() || !navigator.storage?.persist) return;

        // 永続化要求はブラウザが判断しやすいよう、初回の明示的な操作に合わせて行う。
        window.addEventListener('pointerdown', () => {
            void requestPersistentStorage();
        }, { once: true, passive: true });
    });
});
