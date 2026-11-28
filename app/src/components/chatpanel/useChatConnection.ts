import { ref, nextTick, Ref, watch } from 'vue';
import { useAuthStore } from '../../store/auth';
import { useConfigStore } from '../../store/config';
import { useMascotStore } from '../../store/mascot';
import { storeToRefs } from 'pinia';
import { AudioPlaylist } from '../../utils/AudioPlaylist';
import { Message, ChatSession, MessageAttachment } from './useChatHistory';
import { splitSentences } from '../../utils/sentence-splitter';
import { sanitizeForIrodoriTTS } from '../../utils/irodori-sanitizer';
import { useTaskStore } from '../../store/task';
import { useMemoStore } from '../../store/memo';
import { decodeAudioBinaryFrame } from '../../utils/audio-binary-frame';
import { normalizeIrodoriSpeed } from '../../utils/irodori-tts-settings';
import { isLmStudioToolUseEnabled } from '../../utils/lmstudio-tool-settings';
import { toolApprovalLabels, type ToolApprovalRequest } from './tool-approval-display';
import { createChatSessionTitle } from '../../utils/chat-session-title';
import { changeCompanionMemory } from '../../utils/companion-memory-client';

export function useChatConnection(params: {
    messages: Ref<Message[]>;
    activeSessionId: Ref<string | null>;
    isHistoryLoaded?: Ref<boolean>;
    sessions: Ref<ChatSession[]>;
    inputText: Ref<string>;
    saveHistory: () => Promise<void>;
    scrollToBottom: () => void;
}) {
    const {
        messages,
        activeSessionId,
        sessions,
        inputText,
        saveHistory,
        scrollToBottom
    } = params;

    const configStore = useConfigStore();
    const authStore = useAuthStore();
    const mascotStore = useMascotStore();
    const taskStore = useTaskStore();
    if (!taskStore.isLoaded) {
        taskStore.loadFromLocalStorage();
    }
    const memoStore = useMemoStore();
    const companionNotice = ref<{ id: string; mascotId: string } | undefined>();
    const companionNoticeError = ref('');
    const isUndoingCompanion = ref(false);
    async function undoCompanionUpdate() {
        const notice = companionNotice.value;
        if (!notice || isUndoingCompanion.value) return;
        isUndoingCompanion.value = true;
        companionNoticeError.value = '';
        try {
            await changeCompanionMemory(notice.mascotId, { undoId: notice.id });
            if (companionNotice.value?.id === notice.id) companionNotice.value = undefined;
        } catch (error) {
            if (companionNotice.value?.id === notice.id) companionNoticeError.value = error instanceof Error ? error.message : '更新を元に戻せませんでした。';
        } finally { isUndoingCompanion.value = false; }
    }
    if (!memoStore.isLoaded) {
        memoStore.loadFromLocalStorage();
    }

    const playlist = new AudioPlaylist((speaking) => {
        mascotStore.setSpeaking(speaking);
    });

    const {
        chatSendKey,
        activeMascot,
        useServer,
        serverHost,
        serverPort,
        useTts,
        ttsReadNarrative,
        toolsGpsLocation,
        toolsWeather,
        toolsVolume,
        toolsAppLauncher,
        toolsWebSearch,
        lmstudioToolsDisabledModels,
        saveVoice,
        showVoiceLog,
        temperature,
        frequencyPenalty,
        repetitionPenalty,
        maxOutputTokens,
        enableThinking
    } = storeToRefs(configStore);

    const { isLoading: isAiResponding } = storeToRefs(mascotStore);

    watch(useTts, (enabled) => {
        if (!enabled) playlist.stop();
    });

    let socket: WebSocket | null = null;
    const isWsConnected = ref(false);
    let socketReadyPromise: Promise<boolean> | null = null;
    let settleSocketReady: ((connected: boolean) => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectEnabled = true;
    let waitingForConnection = false;
    let pendingUserMessageId: number | null = null;
    let pendingAssistantMessageId: number | null = null;
    let pendingMessages: Message[] | null = null;
    const pendingToolApproval = ref<ToolApprovalRequest | null>(null);
    let approvalTimer: ReturnType<typeof setTimeout> | null = null;

    const respondToToolApproval = (choice: 'deny' | 'approve' | 'remember') => {
        const request = pendingToolApproval.value;
        if (!request) return;
        pendingToolApproval.value = null;
        if (approvalTimer) clearTimeout(approvalTimer);
        approvalTimer = null;
        const canRespond = socket?.readyState === WebSocket.OPEN;
        if (canRespond) socket!.send(JSON.stringify({ event: 'tool-approval-response', data: { id: request.id, approved: choice !== 'deny' } }));
        if (canRespond && choice === 'remember' && Object.hasOwn(toolApprovalLabels, request.name) && configStore.isLoaded) {
            configStore.toolApprovalSkipped = [...new Set([...configStore.toolApprovalSkipped, request.name])];
            void configStore.saveConfig().catch(() => {
                configStore.toolApprovalSkipped = configStore.toolApprovalSkipped.filter(name => name !== request.name);
            });
        }
    };

    // 現在の送信に対応するAI応答バブルを更新する
    const updatePendingMascotMessage = (text: string) => {
        const targetMessages = pendingMessages || messages.value;
        if (pendingAssistantMessageId !== null) {
            const pendingMessage = targetMessages.find(message => message.id === pendingAssistantMessageId);
            if (pendingMessage) {
                pendingMessage.text = text;
                pendingMessage.timestamp = Date.now();
            }
            return;
        }
        for (let i = messages.value.length - 1; i >= 0; i--) {
            if (messages.value[i].sender === 'mascot') {
                messages.value[i].text = text;
                messages.value[i].timestamp = Date.now();
                break;
            }
        }
    };

    const completePendingMessage = async () => {
        if (pendingUserMessageId !== null) {
            const userMessage = (pendingMessages || messages.value).find(message => message.id === pendingUserMessageId);
            if (userMessage) {
                userMessage.deliveryStatus = undefined;
                userMessage.deliveryError = undefined;
            }
        }
        pendingUserMessageId = null;
        pendingAssistantMessageId = null;
        pendingMessages = null;
        await saveHistory();
    };

    const failPendingMessage = async (errorMessage: string) => {
        if (pendingUserMessageId === null && pendingAssistantMessageId === null) {
            return;
        }
        if (pendingUserMessageId !== null) {
            const userMessage = (pendingMessages || messages.value).find(message => message.id === pendingUserMessageId);
            if (userMessage) {
                userMessage.deliveryStatus = 'failed';
                userMessage.deliveryError = errorMessage;
            }
        }
        updatePendingMascotMessage(`接続エラー: ${errorMessage}`);
        pendingUserMessageId = null;
        pendingAssistantMessageId = null;
        pendingMessages = null;
        mascotStore.setLoading(false);
        mascotStore.setSpeaking(false);
        await saveHistory();
    };

    const connectWebSocket = (): Promise<boolean> => {
        reconnectEnabled = true;
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        const currentSocket = socket;
        if (currentSocket?.readyState === WebSocket.OPEN) {
            return Promise.resolve(true);
        }
        if (currentSocket?.readyState === WebSocket.CONNECTING) {
            return socketReadyPromise ?? Promise.resolve(false);
        }
        if (currentSocket) {
            settleSocketReady?.(false);
            socket = null;
            try {
                currentSocket.close();
            } catch {
                // 既に終了処理中のWebSocketはそのまま破棄する
            }
        }

        const isSecure = window.location.protocol === 'https:';
        const wsProtocol = isSecure ? 'wss:' : 'ws:';
        const wsHost = window.location.host;
        const wsUrl = `${wsProtocol}//${wsHost}/ws`;

        console.log(`[useChatConnection] Connecting to WebSocket (Nitro): ${wsUrl}`);

        let currentSocketForHandlers: WebSocket;
        try {
            currentSocketForHandlers = new WebSocket(wsUrl);
        } catch (error) {
            console.error('[useChatConnection] WebSocketの作成に失敗しました:', error);
            socket = null;
            isWsConnected.value = false;
            return Promise.resolve(false);
        }

        socket = currentSocketForHandlers;
        currentSocketForHandlers.binaryType = 'arraybuffer';

        let resolveReady: (connected: boolean) => void = () => {};
        let readySettled = false;
        const readyPromise = new Promise<boolean>((resolve) => {
            resolveReady = resolve;
        });
        socketReadyPromise = readyPromise;

        const settleReady = (connected: boolean) => {
            if (readySettled) return;
            readySettled = true;
            if (settleSocketReady === settleReady) {
                settleSocketReady = null;
            }
            if (socketReadyPromise === readyPromise) {
                socketReadyPromise = null;
            }
            resolveReady(connected);
        };
        settleSocketReady = settleReady;

        currentSocketForHandlers.onopen = () => {
            if (socket !== currentSocketForHandlers) return;
            console.log('[useChatConnection] WebSocket connected');
            isWsConnected.value = true;
            settleReady(true);
            try {
                currentSocketForHandlers.send(JSON.stringify({
                    event: 'client-capabilities',
                    data: { binaryAudioV1: true }
                }));
            } catch (error) {
                console.error('[useChatConnection] WebSocket capability通知の送信に失敗しました:', error);
            }
        };

        currentSocketForHandlers.onmessage = async (event) => {
            if (socket !== currentSocketForHandlers) return;

            try {
                const eventData = event.data as unknown;
                const isBinaryData = eventData instanceof ArrayBuffer
                    || ArrayBuffer.isView(eventData)
                    || (eventData !== null
                        && typeof eventData === 'object'
                        && typeof (eventData as { arrayBuffer?: unknown }).arrayBuffer === 'function');
                if (isBinaryData) {
                    if (useTts.value) {
                        let audioBuffer: ArrayBufferLike | null = null;
                        if (eventData instanceof ArrayBuffer) {
                            audioBuffer = eventData;
                        } else if (ArrayBuffer.isView(eventData)) {
                            const view = eventData as ArrayBufferView;
                            audioBuffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
                        } else {
                            audioBuffer = await (eventData as Blob).arrayBuffer();
                        }
                        if (audioBuffer !== null) {
                            playlist.push(decodeAudioBinaryFrame(audioBuffer));
                        }
                    }
                    return;
                }

                const parsed = JSON.parse(eventData as string);
                const { event: wsEvent, data } = parsed;

                if (wsEvent === 'chat-status') {
                    if (data.status === 'thinking') {
                        mascotStore.setLoading(true);
                    }
                } else if (wsEvent === 'tool-approval-request') {
                    if (typeof data?.id !== 'string' || typeof data?.name !== 'string' || !Object.hasOwn(toolApprovalLabels, data.name) || !data.input || typeof data.input !== 'object' || Array.isArray(data.input)) return;
                    if (configStore.toolApprovalSkipped.includes(data.name)) {
                        socket?.send(JSON.stringify({ event: 'tool-approval-response', data: { id: data.id, approved: true } }));
                    } else if (pendingToolApproval.value) {
                        socket?.send(JSON.stringify({ event: 'tool-approval-response', data: { id: data.id, approved: false } }));
                    } else {
                        const targetId = typeof data.input.id === 'string' ? data.input.id : '';
                        const targetLabel = data.name === 'manageMemos' ? memoStore.memos.find(item => item.id === targetId)?.content
                            : data.name === 'manageTasks' ? taskStore.tasks.find(item => item.id === targetId)?.title : undefined;
                        pendingToolApproval.value = { id: data.id, name: data.name, input: data.input, targetLabel };
                        approvalTimer = setTimeout(() => respondToToolApproval('deny'), 40000);
                    }
                } else if (wsEvent === 'tool-approval-finished') {
                    if (pendingToolApproval.value?.id === data?.id) {
                        pendingToolApproval.value = null;
                        if (approvalTimer) clearTimeout(approvalTimer);
                        approvalTimer = null;
                    }
                } else if (wsEvent === 'tool-status') {
                    const names: Record<string, string> = { searchWeb: 'Web検索', getWeather: '天気の取得', getGPSLocation: '位置情報の取得', adjustVolume: '音量調整', launchApp: 'アプリ起動', manageTasks: 'タスク操作', manageMemos: 'メモ操作', searchPastRecords: '過去の記録検索' };
                    const statuses: Record<string, string> = { started: 'を実行中…', succeeded: 'が完了しました。回答を準備中…', failed: 'に失敗しました。回答を準備中…' };
                    if (names[data.name] && statuses[data.status]) updatePendingMascotMessage(names[data.name] + statuses[data.status]);
                } else if (wsEvent === 'companion-memory-updated') {
                    if (typeof data?.id === 'string' && typeof data?.mascotId === 'string') {
                        companionNotice.value = { id: data.id, mascotId: data.mascotId };
                        companionNoticeError.value = '';
                    }
                } else if (wsEvent === 'chat-response') {
                    const { text, emotion } = data;

                    updatePendingMascotMessage(text);
                    
                    mascotStore.setEmotion(emotion);
                    if (window.electronAPI) {
                        window.electronAPI.changeEmotion(emotion);
                    }

                    mascotStore.setLoading(false);
                    await completePendingMessage();
                    await nextTick();
                    scrollToBottom();
                } else if (wsEvent === 'chat-audio') {
                    const { audio } = data;
                    if (audio && useTts.value) {
                        playlist.push(audio);
                    }
                } else if (wsEvent === 'timer-trigger') {
                    const { memo } = data;
                    console.log('[useChatConnection] Timer triggered from server:', memo);
                    if (window.electronAPI) {
                        window.electronAPI.triggerTimerNotification(memo);
                    }
                } else if (wsEvent === 'task-action') {
                    console.log('[useChatConnection] Task action received:', data?.action, data?.task, data?.taskId);
                    const taskStore = useTaskStore();
                    await taskStore.applyServerTaskAction(data);
                } else if (wsEvent === 'memo-action') {
                    console.log('[useChatConnection] Memo action received:', data?.action, data?.memo, data?.memoId);
                    const memoStore = useMemoStore();
                    await memoStore.applyServerMemoAction(data);
                } else if (wsEvent === 'chat-error') {
                    await failPendingMessage(data.message);
                }
            } catch (e: any) {
                console.error('[useChatConnection] WebSocket message parsing error:', e.message);
            }
        };

        currentSocketForHandlers.onclose = (event) => {
            if (socket !== currentSocketForHandlers) return;
            const code = typeof event?.code === 'number' ? event.code : 'unknown';
            const reason = event?.reason || '理由なし';
            console.log(`[useChatConnection] WebSocket disconnected (code=${code}, reason=${reason})`);
            settleReady(false);
            isWsConnected.value = false;
            respondToToolApproval('deny');
            socket = null;
            if ((pendingUserMessageId !== null || pendingAssistantMessageId !== null) && !waitingForConnection) {
                void failPendingMessage('WebSocket接続が切断されました。');
            }
            if (reconnectEnabled && reconnectTimer === null) {
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    if (reconnectEnabled) {
                        void connectWebSocket();
                    }
                }, 5000);
            }
        };

        currentSocketForHandlers.onerror = (err) => {
            if (socket !== currentSocketForHandlers) return;
            console.error('[useChatConnection] WebSocket connection error:', err);
            settleReady(false);
            if ((pendingUserMessageId !== null || pendingAssistantMessageId !== null) && !waitingForConnection) {
                void failPendingMessage('WebSocket通信でネットワークエラーが発生しました。');
            }
        };

        return readyPromise;
    };

    const waitForSocketConnection = async (): Promise<boolean> => {
        const readyPromise = connectWebSocket();
        if (socket?.readyState === WebSocket.OPEN) {
            return true;
        }

        return new Promise<boolean>((resolve) => {
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
            }, 10000);
            readyPromise.then((connected) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(connected);
            });
        });
    };

    const disconnectWebSocket = () => {
        reconnectEnabled = false;
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        respondToToolApproval('deny');
        const currentSocket = socket;
        socket = null;
        if (pendingUserMessageId !== null || pendingAssistantMessageId !== null) {
            void failPendingMessage('WebSocket接続を終了しました。');
        }
        settleSocketReady?.(false);
        if (currentSocket) {
            try {
                currentSocket.close();
            } catch {
                // 既に切断されたWebSocketはそのまま破棄する
            }
        }
        isWsConnected.value = false;
    };

    const pendingAttachments = ref<MessageAttachment[]>([]);

    const attachFiles = (event: Event) => {
        const input = event.target as HTMLInputElement;
        if (!input.files) return;

        for (let i = 0; i < input.files.length; i++) {
            const file = input.files[i];
            const reader = new FileReader();
            reader.onload = (e) => {
                const url = e.target?.result as string;
                const type = file.type.startsWith('image/') ? 'image' as const : 'file' as const;
                pendingAttachments.value.push({
                    type,
                    name: file.name,
                    url,
                    size: file.size
                });
            };
            reader.readAsDataURL(file);
        }
        input.value = '';
    };

    const removeAttachment = (index: number) => {
        pendingAttachments.value.splice(index, 1);
    };

    const sendMessage = async (isActiveTalk: boolean = false, retryMessageId?: number) => {
        if (params.isHistoryLoaded && !params.isHistoryLoaded.value) return;
        const sentSessionId = activeSessionId.value;
        const sentMascot = activeMascot.value;
        const sentMascotId = sentMascot?.id || 'default';
        const sentMessages = messages.value;
        const sentSession = sessions.value.find(session => session.id === sentSessionId);
        const privateMode = mascotStore.isSecretMode;
        const shouldPersist = authStore.isAuthenticated && !privateMode && !isActiveTalk;
        if (shouldPersist && !sentSessionId) return;
        const retryTarget = retryMessageId !== undefined
            ? sentMessages.find(message => message.id === retryMessageId && message.sender === 'user')
            : undefined;
        if (retryMessageId !== undefined && (!retryTarget || retryTarget.deliveryStatus !== 'failed')) return;
        if (!isActiveTalk && !retryTarget && !inputText.value.trim() && pendingAttachments.value.length === 0) return;
        if (isAiResponding.value) return;

        playlist.stop();

        // アクティブトーク（沈黙時の自発発話）では、生の「...」を送るとモデルが
        // 「リスナーが黙り込んでいる＝不機嫌／気まずい」と否定的に解釈し、マスコットが
        // 不安がってしまう。そこで沈黙を咎めない前向きな進行キューを送る。
        const ACTIVE_TALK_CUE = '（ラジオの生放送中です。今はリスナーからの投稿が届いていない静かな時間帯です。リスナーが黙っているのは番組を楽しく聴いてくれているからで、不機嫌でも気まずいわけでもありません。不安がらず、ラジオパーソナリティとして明るく前向きにトークを続けてください。）';
        const userQuery = isActiveTalk ? ACTIVE_TALK_CUE : (retryTarget?.text || inputText.value);
        if (!isActiveTalk && !retryTarget) {
            inputText.value = '';
        }

        // ラジオモード of ON/OFF指示検出
        if (!isActiveTalk) {
            const query = userQuery.trim().toLowerCase();
            if (query.includes('ラジオモード') || query.includes('radio mode')) {
                if (query.includes('オフ') || query.includes('終了') || query.includes('やめて') || query.includes('off') || query.includes('停止') || query.includes('無効') || query.includes('キャンセル')) {
                    mascotStore.setRadioMode(false);
                } else if (query.includes('オン') || query.includes('開始') || query.includes('はじめて') || query.includes('起動') || query.includes('on') || query.includes('入') || query.includes('有効') || query.includes('つけて')) {
                    mascotStore.setRadioMode(true);
                }
            }
        }

        const attachments = isActiveTalk ? [] : retryTarget
            ? [...(retryTarget.attachments || [])]
            : [...pendingAttachments.value];
        if (!isActiveTalk && !retryTarget) {
            pendingAttachments.value = [];
        }

        let userMessage: Message | null = null;
        if (!isActiveTalk) {
            if (retryTarget) {
                userMessage = retryTarget;
                userMessage.deliveryStatus = 'sending';
                userMessage.deliveryError = undefined;
            } else {
                userMessage = {
                    id: Math.max(Date.now(), (sentMessages.at(-1)?.id ?? 0) + 1),
                    sender: 'user',
                    text: userQuery,
                    timestamp: Date.now(),
                    attachments: attachments.length > 0 ? attachments : undefined,
                    deliveryStatus: 'sending'
                };
                sentMessages.push(userMessage);
            }
        }

        const historyBase = isActiveTalk
            ? sentMessages
            : sentMessages.filter(message => message.id !== userMessage?.id && message.id !== userMessage?.responseMessageId);
        const historyToSend = historyBase
            .filter(m => (m.sender === 'user' && !m.deliveryStatus) || (m.sender === 'mascot' && m.text !== '考え中...' && !m.text.startsWith('接続に失敗しました') && !m.text.startsWith('サーバーに接続されていません') && !m.text.startsWith('接続エラー')))
            .slice(-10)
            .map(m => ({ sender: m.sender, text: m.text }));

        mascotStore.setLoading(true);

        await nextTick();
        scrollToBottom();

        const mascot = sentMascot;
        const engine = configStore.selectedEngine || mascot?.aiConfig?.chat?.engine || 'gemini';

        let apiKey = '';
        if (engine === 'gemini') {
            apiKey = configStore.googleAiStudioApiKey || '';
        } else if (engine === 'openai') {
            apiKey = configStore.openaiApiKey || '';
        } else if (engine === 'anthropic') {
            apiKey = configStore.anthropicApiKey || '';
        }

        const lmsEndpoint = configStore.lmstudioEndpoint || 'http://127.0.0.1:1234/v1/';
        const voicevoxEndpointUrl = configStore.voicevoxEndpoint || 'http://localhost:50021';

        let model = '';
        if (engine === 'lmstudio') {
            model = configStore.lmstudioModel || mascot?.aiConfig?.chat?.model || '';
        } else if (engine === 'gemini') {
            model = configStore.geminiModel || mascot?.aiConfig?.chat?.model || 'gemini-1.5-flash';
        } else if (engine === 'openai') {
            model = configStore.openaiModel || mascot?.aiConfig?.chat?.model || 'gpt-4o';
        } else if (engine === 'anthropic') {
            model = configStore.anthropicModel || mascot?.aiConfig?.chat?.model || 'claude-3-5-sonnet-latest';
        }
        const toolUseEnabled = engine !== 'lmstudio' || isLmStudioToolUseEnabled(lmstudioToolsDisabledModels.value, model);

        const voiceEngine = mascot?.aiConfig?.voice?.engine || configStore.selectedVoiceEngine || 'voicevox';

        const voicevoxSpeakerId = mascot?.aiConfig?.voice?.speaker_id !== undefined
            ? mascot.aiConfig.voice.speaker_id
            : (configStore.voicevoxSpeaker !== undefined ? configStore.voicevoxSpeaker : 2);

        const irodoriEndpointUrl = configStore.irodoriEndpoint || 'http://127.0.0.1:8088';
        const irodoriModel = mascot?.aiConfig?.voice?.irodori_model || configStore.irodoriModel || 'irodori-tts-500m-v3';
        const irodoriVoice = mascot?.aiConfig?.voice?.irodori_voice || configStore.irodoriVoice || 'default';
        const irodoriLora = mascot?.aiConfig?.voice?.irodori_lora || configStore.irodoriLora || '';
        const irodoriSpeed = normalizeIrodoriSpeed(
            mascot?.aiConfig?.voice?.irodori_speed ?? configStore.irodoriSpeed
        );
        const irodoriCaption = mascot?.aiConfig?.voice?.irodori_caption || configStore.irodoriCaption || '';

        const chatMode = isActiveTalk ? 'active_talk' : mascotStore.isRadioMode ? 'radio' : 'normal';

        let aiMessage = retryTarget?.responseMessageId !== undefined
            ? sentMessages.find(message => message.id === retryTarget.responseMessageId && message.sender === 'mascot')
            : undefined;
        if (aiMessage) {
            aiMessage.text = '考え中...';
        } else {
            aiMessage = {
                id: Math.max(Date.now() + 1, (userMessage?.id ?? 0) + 1),
                sender: 'mascot',
                text: '考え中...',
                timestamp: Date.now()
            };
            sentMessages.push(aiMessage);
        }
        const aiMessageId = aiMessage.id;
        if (userMessage) {
            userMessage.responseMessageId = aiMessageId;
            pendingUserMessageId = userMessage.id;
        }
        pendingAssistantMessageId = aiMessageId;
        // 切り替え後も送信元のリアクティブなメッセージを更新する。
        pendingMessages = sentMessages;
        if (sentSession) {
            sentSession.messages = [...sentMessages];
            sentSession.timestamp = Date.now();
            if (!sentSession.isSecret && sentSession.title === '新しい話題') {
                const firstUserMessage = sentMessages.find(item => item.sender === 'user');
                if (firstUserMessage) sentSession.title = createChatSessionTitle(firstUserMessage.text);
            }
        }

        await nextTick();
        scrollToBottom();

        waitingForConnection = true;
        const connected = await waitForSocketConnection();
        waitingForConnection = false;
        if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
            await failPendingMessage('サーバーに接続されていません。再接続後に再送してください。');
            return;
        }

        try {
            socket.send(JSON.stringify({
                event: 'chat-send',
                data: {
                message: userQuery,
                turnId: userMessage ? `${sentSessionId || 'default'}:${userMessage.id}` : crypto.randomUUID(),
                ...(shouldPersist && userMessage ? {
                    memorySessionId: sentSessionId,
                    memoryUserMessageId: userMessage.id,
                    memoryAssistantMessageId: aiMessageId
                } : {}),
                apiKey: apiKey,
                promptVersion: 1,
                chatMode: privateMode ? 'secret' + (chatMode === 'normal' ? '' : '_' + chatMode) : chatMode,
                localProfile: sentMascot?.profile,
                extendedRadio: configStore.useExRadio,
                model: model,
                voicevoxSpeakerId: voicevoxSpeakerId,
                voicevoxEndpoint: voicevoxEndpointUrl,
                selectedVoiceEngine: voiceEngine,
                irodoriEndpoint: irodoriEndpointUrl,
                irodoriModel: irodoriModel,
                irodoriVoice: irodoriVoice,
                irodoriLora: irodoriLora,
                irodoriSpeed: irodoriSpeed,
                irodoriCaption: irodoriCaption,
                engine: engine,
                toolUseEnabled,
                lmstudioEndpoint: lmsEndpoint,
                temperature: temperature.value,
                frequencyPenalty: frequencyPenalty.value,
                repetitionPenalty: repetitionPenalty.value,
                maxOutputTokens: maxOutputTokens.value,
                enableThinking: enableThinking.value,
                history: shouldPersist ? undefined : historyToSend,
                useTts: useTts.value,
                ttsReadNarrative: ttsReadNarrative.value,
                saveVoice: saveVoice.value,
                showVoiceLog: showVoiceLog.value,
                activeMascotId: sentMascotId,
                ttsDictionary: sentMascot?.aiConfig?.ttsDictionary,
                attachments: attachments.length > 0 ? attachments : undefined,
                tools: {
                    toolsGpsLocation: toolsGpsLocation.value,
                    toolsWeather: toolsWeather.value,
                    toolsVolume: toolsVolume.value,
                    toolsAppLauncher: toolsAppLauncher.value,
                    toolsWebSearch: toolsWebSearch.value
                }
                }
            }));
        } catch (error: any) {
            await failPendingMessage(error.message || 'メッセージの送信に失敗しました。');
            return;
        }
        await saveHistory();
    };

    const retryMessage = async (messageId: number) => {
        await sendMessage(false, messageId);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing) return;

        if (chatSendKey.value === 'enter') {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        } else {
            if (event.key === 'Enter' && event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        }
    };

    // 設定変更時の再接続トリガーの監視
    watch(() => useServer.value, (val) => {
        if (val) connectWebSocket();
        else disconnectWebSocket();
    });

    watch([() => serverHost.value, () => serverPort.value], () => {
        if (useServer.value) {
            disconnectWebSocket();
            connectWebSocket();
        }
    });

    return {
        isWsConnected,
        sendMessage,
        retryMessage,
        connectWebSocket,
        disconnectWebSocket,
        handleKeyDown,
        pendingAttachments,
        pendingToolApproval,
        companionNotice,
        companionNoticeError,
        isUndoingCompanion,
        undoCompanionUpdate,
        respondToToolApproval,
        attachFiles,
        removeAttachment
    };
}
