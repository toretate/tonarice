// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useChatConnection } from '../useChatConnection';
import { useTaskStore } from '../../../store/task';
import { useConfigStore } from '../../../store/config';
import { useMascotStore } from '../../../store/mascot';
import { ref } from 'vue';

describe('useChatConnection.ts のタスク連携機能テスト', () => {
    let mockWebSocket: any;
    let originalWebSocket: any;

    beforeEach(() => {
        setActivePinia(createPinia());

        // window.electronAPI のモック
        window.electronAPI = {
            triggerTimerNotification: vi.fn(),
            changeEmotion: vi.fn()
        } as any;

        // グローバルの fetch をモック
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true })
        }) as any;

        // WebSocketのモック設定
        originalWebSocket = global.WebSocket;
        class MockWebSocket {
            static OPEN = 1;
            send = vi.fn();
            close = vi.fn();
            readyState = 1;
            onopen: any = null;
            onmessage: any = null;
            onclose: any = null;
            onerror: any = null;
            constructor(url: string) {
                // 外から参照できるようにグローバル変数に退避
                mockWebSocket = this;
            }
        }
        global.WebSocket = MockWebSocket as any;
    });

    afterEach(() => {
        global.WebSocket = originalWebSocket;
    });

    it('WebSocketから task-action (addSchedule, categoryId: private) を受信した際、重複せず既存の private カテゴリにタスクが追加されること', async () => {
        const taskStore = useTaskStore();
        
        // ストアの初期カテゴリを設定
        taskStore.categories = [
            { id: 'default', name: 'Work', order: 0 },
            { id: 'private', name: 'Private', order: 1 }
        ];
        taskStore.tasks = [];
        taskStore.isLoaded = true;

        const messages = ref<any[]>([]);
        const activeSessionId = ref<string | null>('session_1');
        const sessions = ref<any[]>([]);
        const inputText = ref('');
        const saveHistory = vi.fn().mockResolvedValue(undefined);
        const runCompaction = vi.fn().mockResolvedValue(undefined);
        const scrollToBottom = vi.fn();

        const connection = useChatConnection({
            messages,
            activeSessionId,
            sessions,
            inputText,
            saveHistory,
            runCompaction,
            scrollToBottom
        });

        // WebSocket接続
        connection.connectWebSocket();

        // WebSocketのonmessageハンドラを取得して実行
        const onMessageCallback = (mockWebSocket as any).onmessage;
        expect(onMessageCallback).toBeDefined();

        // ws.tsが送信してくる task-action 形式のメッセージを模倣
        const mockWsEvent = {
            data: JSON.stringify({
                event: 'task-action',
                data: {
                    action: 'addSchedule',
                    task: {
                        id: 'task_private',
                        title: '今日の予定（未定）',
                        scheduledAt: '2026-07-06T18:00:00+09:00',
                        priority: 'normal',
                        categoryId: 'private',
                        completed: false,
                        steps: []
                    },
                    categories: taskStore.categories
                }
            })
        };

        // イベント発火
        await onMessageCallback(mockWsEvent);

        // 検証1: タスクが追加されていること
        expect(taskStore.tasks.length).toBe(1);
        expect(taskStore.tasks[0].title).toBe('今日の予定（未定）');
        
        // 検証2: カテゴリが 'private' に正しく設定されていること (新規に cat_xxx が重複作成されていない)
        expect(taskStore.tasks[0].categoryId).toBe('private');
        expect(taskStore.categories.length).toBe(2); // 'default' と 'private' のまま維持
    });

    it('WebSocketから task-action (addSchedule, categoryId: Work) を受信した際、既存の Work (ID: default) カテゴリに正しく登録されること', async () => {
        const taskStore = useTaskStore();
        taskStore.categories = [
            { id: 'default', name: 'Work', order: 0 },
            { id: 'private', name: 'Private', order: 1 }
        ];
        taskStore.tasks = [];
        taskStore.isLoaded = true;

        const messages = ref<any[]>([]);
        const activeSessionId = ref<string | null>('session_1');
        const sessions = ref<any[]>([]);
        const inputText = ref('');
        const saveHistory = vi.fn().mockResolvedValue(undefined);
        const runCompaction = vi.fn().mockResolvedValue(undefined);
        const scrollToBottom = vi.fn();

        const connection = useChatConnection({
            messages,
            activeSessionId,
            sessions,
            inputText,
            saveHistory,
            runCompaction,
            scrollToBottom
        });

        connection.connectWebSocket();
        const onMessageCallback = (mockWebSocket as any).onmessage;

        const mockWsEvent = {
            data: JSON.stringify({
                event: 'task-action',
                data: {
                    action: 'addSchedule',
                    task: {
                        id: 'task_work',
                        title: '会議',
                        scheduledAt: '2026-07-06T18:00:00+09:00',
                        priority: 'normal',
                        categoryId: 'default',
                        completed: false,
                        steps: []
                    },
                    categories: taskStore.categories
                }
            })
        };

        await onMessageCallback(mockWsEvent);

        // 検証1: タスクのカテゴリIDが 'default' にマッピング（正規化）されていること
        expect(taskStore.tasks.length).toBe(1);
        expect(taskStore.tasks[0].categoryId).toBe('default');
        expect(taskStore.categories.length).toBe(2);
    });

    it('WebSocketから未知のカテゴリ名を受信した際、新規カテゴリが自動的に作成されること', async () => {
        const taskStore = useTaskStore();
        taskStore.categories = [
            { id: 'default', name: 'Work', order: 0 },
            { id: 'private', name: 'Private', order: 1 }
        ];
        taskStore.tasks = [];
        taskStore.isLoaded = true;

        const messages = ref<any[]>([]);
        const activeSessionId = ref<string | null>('session_1');
        const sessions = ref<any[]>([]);
        const inputText = ref('');
        const saveHistory = vi.fn().mockResolvedValue(undefined);
        const runCompaction = vi.fn().mockResolvedValue(undefined);
        const scrollToBottom = vi.fn();

        const connection = useChatConnection({
            messages,
            activeSessionId,
            sessions,
            inputText,
            saveHistory,
            runCompaction,
            scrollToBottom
        });

        connection.connectWebSocket();
        const onMessageCallback = (mockWebSocket as any).onmessage;
        const updatedCategories = [
            ...taskStore.categories,
            { id: 'cat_study', name: '勉強', order: 2 }
        ];

        const mockWsEvent = {
            data: JSON.stringify({
                event: 'task-action',
                data: {
                    action: 'addSchedule',
                    task: {
                        id: 'task_study',
                        title: '勉強',
                        scheduledAt: '2026-07-06T19:00:00+09:00',
                        priority: 'normal',
                        categoryId: 'cat_study',
                        completed: false,
                        steps: []
                    },
                    categories: updatedCategories
                }
            })
        };

        await onMessageCallback(mockWsEvent);

        // 検証1: カテゴリが新しく追加され、計 3 つになっていること
        expect(taskStore.categories.length).toBe(3);
        const newCat = taskStore.categories[2];
        expect(newCat.name).toBe('勉強');

        // 検証2: タスクがその新しく追加されたカテゴリIDに紐づけられていること
        expect(taskStore.tasks.length).toBe(1);
        expect(taskStore.tasks[0].categoryId).toBe(newCat.id);
    });

    it('sendMessage - WebSocket未接続時にユーザーバブルを失敗表示にすること', async () => {
        const messages = ref<any[]>([]);
        const saveHistory = vi.fn().mockResolvedValue(undefined);
        const connection = useChatConnection({
            messages,
            activeSessionId: ref('session_1'),
            sessions: ref([]),
            inputText: ref('再送テスト'),
            saveHistory,
            runCompaction: vi.fn().mockResolvedValue(undefined),
            scrollToBottom: vi.fn()
        });

        await connection.sendMessage();

        const userMessage = messages.value.find(message => message.sender === 'user');
        expect(userMessage).toMatchObject({
            text: '再送テスト',
            deliveryStatus: 'failed'
        });
        expect(userMessage.deliveryError).toContain('サーバーに接続されていません');
        expect(saveHistory).toHaveBeenCalled();
    });

    it('retryMessage - 失敗したバブルを複製せず再送し、成功時に失敗表示を解除すること', async () => {
        const messages = ref<any[]>([]);
        const connection = useChatConnection({
            messages,
            activeSessionId: ref('session_1'),
            sessions: ref([]),
            inputText: ref('もう一度送る'),
            saveHistory: vi.fn().mockResolvedValue(undefined),
            runCompaction: vi.fn().mockResolvedValue(undefined),
            scrollToBottom: vi.fn()
        });

        // 初回は未接続のため失敗し、内部で再接続用WebSocketが作成される
        await connection.sendMessage();
        const failedMessage = messages.value.find(message => message.sender === 'user');

        await connection.retryMessage(failedMessage.id);
        expect(mockWebSocket.send).toHaveBeenCalledOnce();
        expect(messages.value.filter(message => message.sender === 'user')).toHaveLength(1);
        expect(failedMessage.deliveryStatus).toBe('sending');

        await mockWebSocket.onmessage({
            data: JSON.stringify({
                event: 'chat-response',
                data: { text: '再送に成功しました。', emotion: 'happy' }
            })
        });

        expect(failedMessage.deliveryStatus).toBeUndefined();
        expect(failedMessage.deliveryError).toBeUndefined();
        expect(messages.value.filter(message => message.sender === 'mascot')).toHaveLength(1);
        expect(messages.value.find(message => message.sender === 'mascot')?.text).toBe('再送に成功しました。');
    });
});
