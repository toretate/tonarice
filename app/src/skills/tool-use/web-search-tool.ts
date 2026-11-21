import { tool } from '@lmstudio/sdk';
import { z } from 'zod';
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
