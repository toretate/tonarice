import { tool } from '@lmstudio/sdk';
// LM Studio SDK のツール定義は Zod 3 のスキーマを受け取る。
import { z } from 'zod/v3';
import { searchWeb, webSearchDescription } from './web-search-core';

export const webSearchTool = tool({
    name: 'searchWeb',
    description: webSearchDescription,
    parameters: {
        query: z.string().describe('検索キーワード')
    },
    implementation: async ({ query }) => {
        const result = await searchWeb(query);
        return typeof result === 'string' ? result : JSON.stringify(result);
    }
});
