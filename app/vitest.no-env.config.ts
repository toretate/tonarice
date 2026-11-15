import { defineConfig } from 'vitest/config';

// 秘密情報を含む環境ファイルを読み込まない単体テスト用設定。
export default defineConfig({
    envDir: false,
    test: {
        environment: 'node',
        include: [
            'src/server/utils/__tests__/lmstudio-model-management.test.ts',
            'src/server/api/lmstudio/__tests__/reload.test.ts'
        ]
    }
});
