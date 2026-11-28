import { ref, nextTick, computed, watch } from 'vue';
import { useConfigStore } from '../../store/config';
import { useMascotStore } from '../../store/mascot';
import { storeToRefs } from 'pinia';
import { createChatSessionTitle } from '../../utils/chat-session-title';

export interface MessageAttachment {
    type: 'image' | 'file';
    name: string;
    url: string;
    size?: number;
}

export interface Message {
    id: number;
    sender: 'user' | 'mascot';
    text: string;
    /** メッセージが画面へ追加された時刻（Unixミリ秒） */
    timestamp?: number;
    attachments?: MessageAttachment[];
    /** ユーザーメッセージの送信状態。成功後は未設定に戻す。 */
    deliveryStatus?: 'sending' | 'failed';
    deliveryError?: string;
    /** 再送時に同じAI応答バブルを再利用するためのID */
    responseMessageId?: number;
}

export interface ChatSession {
    id: string;
    title: string;
    timestamp: number;
    messages: Message[];
    isSecret?: boolean;
}

export interface MascotHistory {
    activeSessionId?: string;
    sessions: ChatSession[];
    activeSecretSessionId?: string;
    secretSessions?: ChatSession[];
}

export function useChatHistory(scrollToBottom: () => void) {
    const configStore = useConfigStore();
    const mascotStore = useMascotStore();

    const { activeMascot } = storeToRefs(configStore);
    const { isSecretMode } = storeToRefs(mascotStore);

    const allHistories = ref<Record<string, MascotHistory>>({});
    const sessions = ref<ChatSession[]>([]);
    const activeSessionId = ref<string | null>(null);
    const messages = ref<Message[]>([]);
    const showHistoryList = ref(false);
    const isHistoryLoaded = ref(false);
    const historyError = ref('');
    const isHistoryLoading = ref(false);
    const loadedMemoryMascots = new Set<string>();
    let historyRequest = 0;
    let hasStartedHistoryLoad = false;
    let selectionScope: string | undefined;

    // 本文を複製せず、利用者・接続先・マスコットごとの選択だけを保存する。
    const selectionKey = (mascotId: string) => selectionScope
        ? `mastra-active-session:${JSON.stringify([window.location.origin, selectionScope, mascotId])}` : undefined;
    const loadSelection = (mascotId: string) => {
        const key = selectionKey(mascotId);
        try { return key ? localStorage.getItem(key) || undefined : undefined; }
        catch { return undefined; }
    };

    const deleteFromMastra = async (kind: 'message' | 'thread', sessionId: string, messageId?: number) => {
        try {
            const response = await fetch('/api/mastra-history', {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, sessionId, messageId, mascotId: activeMascot.value?.id || 'default' })
            });
            if (response.ok) { historyError.value = ''; return true; }
        } catch {
            // 保存先に接続できない場合は画面上にも残す。
        }
        historyError.value = '履歴を削除できませんでした。応答が完了してから、もう一度お試しください。';
        return false;
    };

    const getDefaultMessage = () => {
        return {
            id: 1,
            sender: 'mascot' as const,
            text: 'こんにちは！今日はどんなお話をしますか？',
            timestamp: Date.now()
        };
    };

    const createNewSession = (isSecret = false): ChatSession => {
        return {
            id: Date.now().toString(),
            title: isSecret ? 'シークレットの話題' : '新しい話題',
            timestamp: Date.now(),
            messages: [getDefaultMessage()],
            isSecret
        };
    };

    const applyActiveMascotHistory = () => {
        if (!isHistoryLoaded.value) return;

        const mascotId = activeMascot.value?.id || 'default';
        if (!allHistories.value[mascotId]) {
            const initialSession = createNewSession(isSecretMode.value);
            allHistories.value[mascotId] = isSecretMode.value ? {
                activeSecretSessionId: initialSession.id,
                secretSessions: [initialSession],
                sessions: []
            } : {
                activeSessionId: initialSession.id,
                sessions: [initialSession]
            };
        }
        
        const mascotHistory = allHistories.value[mascotId];
        
        if (isSecretMode.value) {
            if (!mascotHistory.secretSessions || mascotHistory.secretSessions.length === 0) {
                const initialSession = createNewSession(true);
                mascotHistory.secretSessions = [initialSession];
                mascotHistory.activeSecretSessionId = initialSession.id;
            }
            sessions.value = mascotHistory.secretSessions;
            
            let currentSession = sessions.value.find(s => s.id === mascotHistory.activeSecretSessionId);
            if (!currentSession && sessions.value.length > 0) {
                currentSession = sessions.value[0];
            }
            
            if (currentSession) {
                activeSessionId.value = currentSession.id;
                messages.value = [...currentSession.messages];
            } else {
                const initialSession = createNewSession(true);
                sessions.value = [initialSession];
                mascotHistory.secretSessions = sessions.value;
                mascotHistory.activeSecretSessionId = initialSession.id;
                activeSessionId.value = initialSession.id;
                messages.value = [...initialSession.messages];
            }
        } else {
            sessions.value = mascotHistory.sessions || [];
            
            let currentSession = sessions.value.find(s => s.id === mascotHistory.activeSessionId);
            if (!currentSession && sessions.value.length > 0) {
                currentSession = sessions.value[0];
            }
            
            if (currentSession) {
                activeSessionId.value = currentSession.id;
                messages.value = [...currentSession.messages];
            } else {
                const initialSession = createNewSession(false);
                sessions.value = [initialSession];
                mascotHistory.sessions = sessions.value;
                mascotHistory.activeSessionId = initialSession.id;
                activeSessionId.value = initialSession.id;
                messages.value = [...initialSession.messages];
            }
        }
        nextTick(() => scrollToBottom());
    };

    async function loadMemoryHistory(mascotId: string, request: number) {
        const query = new URLSearchParams({ mascotId });
        const response = await fetch(`/api/mastra-history?${query}`, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('履歴の読み込みに失敗しました。');
        const data = await response.json() as { selectionScope?: string; sessions?: ChatSession[] };
        if (request !== historyRequest || (activeMascot.value?.id || 'default') !== mascotId) return;
        // 認証済みAPIが返す識別子で固定し、設定画面の認証状態に依存しない。
        const nextScope = typeof data.selectionScope === 'string' && data.selectionScope ? data.selectionScope : undefined;
        if (selectionScope !== nextScope) {
            allHistories.value = {};
            loadedMemoryMascots.clear();
        }
        selectionScope = nextScope;
        loadedMemoryMascots.add(mascotId);
        const existing = allHistories.value[mascotId];
        allHistories.value[mascotId] = {
            ...existing,
            sessions: data.sessions ?? [],
            activeSessionId: existing?.activeSessionId || loadSelection(mascotId)
        };
    }

    const loadHistory = async () => {
        hasStartedHistoryLoad = true;
        const request = ++historyRequest;
        const mascotId = activeMascot.value?.id || 'default';
        isHistoryLoaded.value = false;
        isHistoryLoading.value = true;
        historyError.value = '';
        try {
            await loadMemoryHistory(mascotId, request);
        } catch {
            if (request === historyRequest) {
                historyError.value = 'チャット履歴を読み込めませんでした。接続を確認し、再試行してください。';
            }
            return;
        } finally {
            if (request === historyRequest) isHistoryLoading.value = false;
        }
        if (request !== historyRequest || (activeMascot.value?.id || 'default') !== mascotId) return;
        isHistoryLoaded.value = true;
        applyActiveMascotHistory();
    };

    const saveHistoryForMascot = async (mascotId: string) => {
        if (!isHistoryLoaded.value) return;

        if (activeSessionId.value) {
            const currentSession = sessions.value.find(s => s.id === activeSessionId.value);
            if (currentSession) {
                currentSession.messages = [...messages.value];
                currentSession.timestamp = Date.now();
                const firstUserMsg = messages.value.find(m => m.sender === 'user');
                const defaultTitle = isSecretMode.value ? 'シークレットの話題' : '新しい話題';
                if (firstUserMsg && currentSession.title === defaultTitle) {
                    currentSession.title = createChatSessionTitle(firstUserMsg.text);
                }
            }
        }
        
        // タイムスタンプ降順でソート
        sessions.value.sort((a, b) => b.timestamp - a.timestamp);
        
        if (!allHistories.value[mascotId]) {
            allHistories.value[mascotId] = { sessions: [] };
        }
        
        if (isSecretMode.value) {
            allHistories.value[mascotId].activeSecretSessionId = activeSessionId.value || undefined;
            allHistories.value[mascotId].secretSessions = sessions.value;
        } else {
            allHistories.value[mascotId].activeSessionId = activeSessionId.value || undefined;
            allHistories.value[mascotId].sessions = sessions.value;
            if (activeSessionId.value) {
                const key = selectionKey(mascotId);
                try { if (key) localStorage.setItem(key, activeSessionId.value); }
                catch { /* 保存容量がない場合も会話は継続できる。 */ }
            }
        }
    };

    const saveHistory = async () => {
        if (!isHistoryLoaded.value) return;
        const mascotId = activeMascot.value?.id || 'default';
        await saveHistoryForMascot(mascotId);
    };

    const clearHistory = async () => {
        if (!isHistoryLoaded.value || mascotStore.isLoading) return;
        const newSession = createNewSession(isSecretMode.value);
        sessions.value.unshift(newSession);
        activeSessionId.value = newSession.id;
        messages.value = [...newSession.messages];
        showHistoryList.value = false;
        await saveHistory();
    };

    const selectSession = (sessionId: string) => {
        if (mascotStore.isLoading) return;
        activeSessionId.value = sessionId;
        const currentSession = sessions.value.find(s => s.id === sessionId);
        if (currentSession) {
            messages.value = [...currentSession.messages];
        }
        showHistoryList.value = false;
        const mascotId = activeMascot.value?.id || 'default';
        if (allHistories.value[mascotId]) {
            if (isSecretMode.value) {
                allHistories.value[mascotId].activeSecretSessionId = sessionId;
            } else {
                allHistories.value[mascotId].activeSessionId = sessionId;
            }
        }
        saveHistory();
        nextTick(() => scrollToBottom());
    };

    const deleteSession = async (sessionId: string, event: Event) => {
        event.stopPropagation();
        const originalSessions = sessions.value;
        if (!isSecretMode.value) {
            if (mascotStore.isLoading || !await deleteFromMastra('thread', sessionId)) return;
            if (sessions.value !== originalSessions) return;
        }
        
        sessions.value = sessions.value.filter(s => s.id !== sessionId);
        
        if (sessions.value.length === 0) {
            const newSession = createNewSession(isSecretMode.value);
            sessions.value = [newSession];
        }
        
        if (activeSessionId.value === sessionId) {
            activeSessionId.value = sessions.value[0].id;
            messages.value = [...sessions.value[0].messages];
        }
        
        const mascotId = activeMascot.value?.id || 'default';
        if (allHistories.value[mascotId]) {
            if (isSecretMode.value) {
                allHistories.value[mascotId].secretSessions = sessions.value;
                allHistories.value[mascotId].activeSecretSessionId = activeSessionId.value || undefined;
            } else {
                allHistories.value[mascotId].sessions = sessions.value;
                allHistories.value[mascotId].activeSessionId = activeSessionId.value || undefined;
            }
        }
        
        await saveHistory();
    };

    const toggleHistoryList = () => {
        showHistoryList.value = !showHistoryList.value;
    };

    // マスコット切り替え時の履歴適用
    watch(() => activeMascot.value?.id, async (newId) => {
        if (!hasStartedHistoryLoad) return;
        if (!loadedMemoryMascots.has(newId || 'default')) {
            await loadHistory();
            return;
        }
        historyRequest++;
        isHistoryLoading.value = false;
        isHistoryLoaded.value = true;
        historyError.value = '';
        applyActiveMascotHistory();
    });

    // シークレットモード切り替え時の履歴適用
    watch(isSecretMode, async (newVal, oldVal) => {
        if (!isHistoryLoaded.value) return;
        const mascotId = activeMascot.value?.id || 'default';
        if (!allHistories.value[mascotId]) {
            allHistories.value[mascotId] = { sessions: [] };
        }
        
        // 切り替え前のデータを退避
        const wasSecret = oldVal;
        if (wasSecret) {
            allHistories.value[mascotId].activeSecretSessionId = activeSessionId.value || undefined;
            allHistories.value[mascotId].secretSessions = sessions.value;
        } else {
            allHistories.value[mascotId].activeSessionId = activeSessionId.value || undefined;
            allHistories.value[mascotId].sessions = sessions.value;
        }
        
        // 切り替え後のデータを適用
        applyActiveMascotHistory();
    });

    const deleteMessage = async (messageId: number) => {
        const sessionId = activeSessionId.value;
        const originalSessions = sessions.value;
        if (!isSecretMode.value && sessionId) {
            if (mascotStore.isLoading || !await deleteFromMastra('message', sessionId, messageId)) return;
            if (sessionId !== activeSessionId.value || originalSessions !== sessions.value) return;
        }
        messages.value = messages.value.filter(m => m.id !== messageId);
        await saveHistory();
    };

    return {
        allHistories,
        sessions,
        activeSessionId,
        messages,
        showHistoryList,
        isHistoryLoaded,
        historyError,
        isHistoryLoading,
        loadHistory,
        saveHistory,
        clearHistory,
        selectSession,
        deleteSession,
        deleteMessage,
        toggleHistoryList,
        applyActiveMascotHistory
    };
}
