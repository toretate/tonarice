/**
 * Mastra 1.57.0の公開パッケージに欠けているテストユーティリティの型定義。
 * 実行モジュールは`exports`と`dist`に含まれている。
 */
declare module '@mastra/core/test-utils/llm-mock' {
    export interface CreateMockModelOptions {
        objectGenerationMode?: 'json';
        mockText: unknown;
        spyGenerate?: unknown;
        spyStream?: unknown;
        version?: 'v1' | 'v2';
    }

    export function createMockModel(options: CreateMockModelOptions): unknown;
}
