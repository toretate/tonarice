import { createTool } from '@mastra/core/tools';
import { searchWeb, webSearchDescription, webSearchInputSchema } from '../../skills/tool-use/web-search-core';

/**
 * 既存の検索処理をMastra Agentへ公開する。
 */
export const mastraWebSearchTool = createTool({
    id: 'searchWeb',
    description: webSearchDescription,
    inputSchema: webSearchInputSchema,
    execute: async ({ query }, { requestContext, abortSignal }) => {
        if (requestContext.get('webSearchEnabled') !== true) {
            return { error: 'Web検索ツールは無効です。' };
        }
        if (requestContext.get('webSearchUsed') === true) {
            return { error: 'この発話ではWeb検索を実行済みです。' };
        }
        requestContext.set('webSearchUsed', true);
        console.info('[MastraTool] searchWebの実行を開始');
        const result = await searchWeb(query, abortSignal);
        if (typeof result === 'string') {
            console.warn('[MastraTool] searchWebの実行に失敗');
            return { error: result };
        }
        console.info('[MastraTool] searchWebの実行が完了');
        return { results: result };
    }
});
