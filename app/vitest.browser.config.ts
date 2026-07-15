import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkgRoot = path.resolve(__dirname, '../packages/expression-alignment');

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@prompt': fileURLToPath(new URL('./src/skills/tool-use/prompts', import.meta.url)),
            '@desktop-ai-mascot/expression-alignment/adapters/opencv-browser':
                path.resolve(pkgRoot, 'adapters/opencv-browser.ts'),
            '@desktop-ai-mascot/expression-alignment': path.resolve(pkgRoot, 'src/index.ts'),
            '@techstark/opencv-js': path.resolve(pkgRoot, 'node_modules/@techstark/opencv-js'),
        },
    },
    server: {
        fs: {
            allow: [__dirname, pkgRoot],
        },
    },
    optimizeDeps: {
        exclude: ['@desktop-ai-mascot/expression-alignment'],
    },
    test: {
        include: ['src/**/*.browser.test.ts'],
        browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
        },
    },
});
