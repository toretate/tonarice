import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import { createRevisionSave } from './revision-save';

export interface Memo {
    id: string;
    content: string;
    color?: string;
    pinned?: boolean;
    order: number;
    createdAt: string;
    updatedAt: string;
}

export interface ServerMemoActionPayload {
    action: 'add' | 'update' | 'delete';
    memo?: Memo;
    memoId?: string;
    revision?: number;
}

export const useMemoStore = defineStore('memo', () => {
    const memos = ref<Memo[]>([]);
    const showMemoWidget = ref<boolean>(false);
    const isLoaded = ref(false);
    const serverRevision = ref<number | null>(null);
    let suppressServerSync = 0;

    const persistLocalOnly = () => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem('desktop-mascot-memos', JSON.stringify(memos.value));
            localStorage.setItem('desktop-mascot-show-memo-widget', String(showMemoWidget.value));
        } catch (error) {
            console.error('LocalStorageへのメモ保存エラー:', error);
        }
    };

    /**
     * サーバー起点の状態反映では watch による全件 POST を抑止し、LocalStorage のみ更新する。
     */
    const runFromServer = (fn: () => void) => {
        suppressServerSync += 1;
        try {
            fn();
            persistLocalOnly();
        } finally {
            suppressServerSync -= 1;
        }
    };

    const sync = createRevisionSave({
        url: '/api/memos',
        revision: serverRevision,
        read: () => ({ memos: memos.value }),
        collections: ['memos'],
        apply: data => runFromServer(() => {
            memos.value = data.memos as Memo[];
        })
    });

    const reloadFromServer = async () => {
        if (typeof window === 'undefined') return;
        try {
            const res = await fetch('/api/memos', { credentials: 'include' });
            if (!res.ok) return;
            const contentType = res.headers.get('content-type') ?? '';
            if (!contentType.includes('application/json')) return;
            const resJson = await res.json();
            if (!resJson.success) return;
            if (sync.isPending()) return;
            if (Number.isSafeInteger(resJson.revision) && resJson.revision >= (serverRevision.value ?? 0)) {
                sync.mergeRemote(resJson, resJson.revision);
            }
        } catch (error) {
            console.warn('サーバーからのメモ再読込失敗:', error);
        }
    };

    const loadFromLocalStorage = async () => {
        if (typeof window === 'undefined' || sync.isPending()) return;

        // 1. ローカルストレージからの読み込み
        suppressServerSync += 1;
        try {
            const savedMemos = localStorage.getItem('desktop-mascot-memos');
            if (savedMemos) {
                memos.value = JSON.parse(savedMemos);
            }
            const savedShowWidget = localStorage.getItem('desktop-mascot-show-memo-widget');
            if (savedShowWidget) {
                showMemoWidget.value = savedShowWidget === 'true';
            }
        } catch (error) {
            console.warn('LocalStorageからのメモ読み込みエラー:', error);
        } finally {
            suppressServerSync -= 1;
        }

        // 2. サーバーからの読み込み
        let recoveredFromLocal = false;
        try {
            const res = await fetch('/api/memos', { credentials: 'include' });
            if (res.ok) {
                const contentType = res.headers.get('content-type') ?? '';
                if (!contentType.includes('application/json')) {
                    throw new Error(`メモAPIがJSON以外を返しました (${contentType || 'Content-Typeなし'})`);
                }
                const resJson = await res.json();
                const revision = Number.isSafeInteger(resJson.revision) && resJson.revision >= 0 ? resJson.revision : 0;
                if (resJson.success && !sync.isPending() && revision >= (serverRevision.value ?? 0)) {
                    const serverMemos = Array.isArray(resJson.memos) ? resJson.memos : [];
                    runFromServer(() => {
                        sync.adopt(resJson, revision);
                        if (revision > 0 || serverMemos.length > 0 || memos.value.length === 0) {
                            memos.value = serverMemos;
                        } else {
                            recoveredFromLocal = true;
                            console.warn('[MemoStore] サーバーのメモが空のため、ローカルの既存データを保持しました。');
                        }
                    });
                }
            } else if (memos.value.length > 0) {
                recoveredFromLocal = true;
            }
        } catch (error) {
            console.warn('サーバーからのメモロード失敗:', error);
        } finally {
            isLoaded.value = true;
            if (recoveredFromLocal) {
                saveToLocalStorage();
            }
        }
    };

    const saveToLocalStorage = () => {
        if (typeof window === 'undefined' || !isLoaded.value) return;

        persistLocalOnly();

        if (serverRevision.value !== null) sync.request();
    };

    watch(
        [() => memos.value, () => showMemoWidget.value],
        () => {
            if (suppressServerSync > 0 || !isLoaded.value) return;
            saveToLocalStorage();
        },
        { deep: true, flush: 'sync' }
    );

    const sortedMemos = computed(() => {
        // pinnedが上のもの、次いでorderまたはcreatedAtの新しい順
        return [...memos.value].sort((a, b) => {
            if (a.pinned !== b.pinned) {
                return a.pinned ? -1 : 1;
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    });

    const addMemo = (content: string, color?: string, pinned?: boolean) => {
        const id = 'memo_' + Math.random().toString(36).substring(2, 11);
        memos.value.push({
            id,
            content,
            color: color || 'yellow',
            pinned: pinned || false,
            order: memos.value.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    };

    const addMemoFromServer = (memo: Memo) => {
        runFromServer(() => {
            const idx = memos.value.findIndex(m => m.id === memo.id);
            if (idx === -1) {
                memos.value.push(memo);
            } else {
                memos.value[idx] = memo;
            }
        });
    };

    const deleteMemoFromServer = (id: string) => {
        runFromServer(() => {
            memos.value = memos.value.filter(m => m.id !== id);
        });
    };

    /**
     * WebSocket 経由のサーバー起点メモ更新を適用する。
     * サーバーへの書き戻し（POST）は発生させず、リビジョン欠落を検知した場合は最新を再読込する。
     */
    const applyServerMemoAction = async (payload: ServerMemoActionPayload) => {
        while (sync.isPending()) await sync.settled();
        const { action, memo, memoId, revision } = payload;
        const hasValidRevision = typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
        if (hasValidRevision) {
            const currentRevision = serverRevision.value;
            if (currentRevision !== null && revision <= currentRevision) return;
            if (currentRevision === null || revision > currentRevision + 1) {
                await reloadFromServer();
                return;
            }
            sync.applyDelta(revision, data => {
                const entries = (data.memos as Memo[] | undefined) || [];
                if (action === 'delete') return { memos: entries.filter(item => item.id !== memoId) };
                const next = memo && entries.some(item => item.id === memo.id)
                    ? entries.map(item => item.id === memo.id ? memo : item)
                    : memo ? [...entries, memo] : entries;
                return { memos: next };
            });
            return;
        }

        if (action === 'delete') {
            if (memoId) {
                runFromServer(() => {
                    memos.value = memos.value.filter(m => m.id !== memoId);
                });
            }
            return;
        }

        if (memo && (action === 'add' || action === 'update')) {
            runFromServer(() => {
                const idx = memos.value.findIndex(m => m.id === memo.id);
                if (idx >= 0) {
                    memos.value[idx] = memo;
                } else {
                    memos.value.push(memo);
                }
            });
        }
    };

    const updateMemo = (id: string, updates: Partial<Memo>) => {
        const memo = memos.value.find(m => m.id === id);
        if (memo) {
            Object.assign(memo, updates);
            memo.updatedAt = new Date().toISOString();
        }
    };

    const deleteMemo = (id: string) => {
        memos.value = memos.value.filter(m => m.id !== id);
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', (e) => {
            if (e.key === 'desktop-mascot-memos' || e.key === 'desktop-mascot-show-memo-widget') {
                isLoaded.value = false;
                loadFromLocalStorage();
            }
        });
    }

    return {
        memos,
        showMemoWidget,
        isLoaded,
        serverRevision,
        sortedMemos,
        loadFromLocalStorage,
        reloadFromServer,
        saveToLocalStorage,
        addMemo,
        addMemoFromServer,
        deleteMemoFromServer,
        applyServerMemoAction,
        updateMemo,
        deleteMemo
    };
});
