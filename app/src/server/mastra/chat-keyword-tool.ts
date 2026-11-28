import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { keywordTerms, searchConversationKeywords, searchSharedKeywords } from './chat-keyword-search';
import { isOwnedMascot } from '../utils/mascot-prompts';
import { observeTool } from './tool-observation';

export interface KeywordSearchScope { filename: string; owner: string; mascot: string; currentThread: string }

export const mastraKeywordSearchTool = createTool({
    id: 'searchPastRecords',
    description: '以前の別の会話、共有メモ、共有タスクから合意事項や経緯を検索する。過去の記録が必要な場合だけ、固有名詞や短い検索語を渡す。',
    inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
    execute: async ({ query }, { requestContext, abortSignal }) => {
        const scope = requestContext.get('keywordSearchScope') as KeywordSearchScope | undefined;
        if (!scope || !isOwnedMascot(scope.owner, scope.mascot)) return { results: [] };
        return observeTool(requestContext, 'searchPastRecords', async () => {
            try {
                const terms = keywordTerms(query);
                const results = searchConversationKeywords(scope.filename, scope.owner, scope.mascot, scope.currentThread, terms, abortSignal);
                abortSignal?.throwIfAborted();
                return { results: [...results, ...searchSharedKeywords(scope.owner, terms)] };
            } catch {
                console.warn('[記憶検索] 検索を完了できませんでした。');
                return { results: [], unavailable: true };
            }
        }, result => result.unavailable === true);
    }
});
