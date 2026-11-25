import { ref } from 'vue';
import type { Ref } from 'vue';
import type { ConversationKind } from '../../types/scheduled-prompt-task';
import { CoWorkApiError, requestCoWork } from './cowork-api';
import { useCoWorkPolling } from './useCoWorkPolling';

export function useCoWorkUnread(conversationKind: Ref<ConversationKind>) {
    const unread = ref(0);
    let scope: string | undefined;
    let known = new Set<string>();
    const reload = useCoWorkPolling(async (signal) => {
        try {
            const data = await requestCoWork<{ scope: string; completedIds: string[] }>('/activity', {
                signal, priority: 'low'
            });
            if (signal.aborted) return;
            if (scope !== data.scope) {
                unread.value = 0;
            } else if (conversationKind.value === 'chat') {
                unread.value += data.completedIds.filter(id => !known.has(id)).length;
            }
            scope = data.scope;
            known = new Set(data.completedIds);
        } catch (error) {
            if (!signal.aborted && error instanceof CoWorkApiError && [401, 403].includes(error.status)) {
                scope = undefined;
                known.clear();
                unread.value = 0;
            }
        }
    });
    return { unread, reload };
}
