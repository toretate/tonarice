import { defineNuxtPlugin } from 'nuxt/app';
import '@/utils/browser-polyfill';

export default defineNuxtPlugin(() => {
    // Webブラウザ環境向けのブラウザポリフィルを読み込む
});
