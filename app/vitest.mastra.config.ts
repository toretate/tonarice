import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Mastra検証ではローカルの.envを読み込まず、呼び出し元の環境変数だけを使用する。
 */
export default defineConfig({
    envDir: false,
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@prompt': fileURLToPath(new URL('./src/skills/tool-use/prompts', import.meta.url))
        }
    },
    test: {
        environment: 'node',
        exclude: [...configDefaults.exclude, '**/*.browser.test.ts']
    }
});
