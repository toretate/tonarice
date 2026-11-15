import { ref, nextTick, Ref, watch } from 'vue';
import { useConfigStore } from '../../store/config';
import { useMascotStore } from '../../store/mascot';
import { storeToRefs } from 'pinia';
import { AudioPlaylist } from '../../utils/AudioPlaylist';
import { Message, ChatSession, MessageAttachment } from './useChatHistory';
import useRadioMode from './use-radiomode-prompt';
import useIrodoriEmotion from './use-irodori-emotion';
import { splitSentences } from '../../utils/sentence-splitter';
import { sanitizeForIrodoriTTS } from '../../utils/irodori-sanitizer';
import { useTaskStore } from '../../store/task';
import { useMemoStore } from '../../store/memo';
import { decodeAudioBinaryFrame } from '../../utils/audio-binary-frame';
import { normalizeIrodoriSpeed } from '../../utils/irodori-tts-settings';
import { isLmStudioToolUseEnabled } from '../../utils/lmstudio-tool-settings';

export function useChatConnection(params: {
    messages: Ref<Message[]>;
    activeSessionId: Ref<string | null>;
    sessions: Ref<ChatSession[]>;
    inputText: Ref<string>;
    saveHistory: () => Promise<void>;
    runCompaction: (mascotId: string, sessionId: string) => Promise<void>;
    scrollToBottom: () => void;
}) {
    const {
        messages,
        activeSessionId,
        sessions,
        inputText,
        saveHistory,
        runCompaction,
        scrollToBottom
    } = params;

    const configStore = useConfigStore();
    const mascotStore = useMascotStore();
    const taskStore = useTaskStore();
    if (!taskStore.isLoaded) {
        taskStore.loadFromLocalStorage();
    }
    const memoStore = useMemoStore();
    if (!memoStore.isLoaded) {
        memoStore.loadFromLocalStorage();
    }
    let compactionTimer: any = null;

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

    // 現在の送信に対応するAI応答バブルを更新する
    const updatePendingMascotMessage = (text: string) => {
        if (pendingAssistantMessageId !== null) {
            const pendingMessage = messages.value.find(message => message.id === pendingAssistantMessageId);
            if (pendingMessage) {
                pendingMessage.text = text;
                pendingMessage.timestamp = Date.now();
                return;
            }
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
            const userMessage = messages.value.find(message => message.id === pendingUserMessageId);
            if (userMessage) {
                userMessage.deliveryStatus = undefined;
                userMessage.deliveryError = undefined;
            }
        }
        pendingUserMessageId = null;
        pendingAssistantMessageId = null;
        await saveHistory();
    };

    const failPendingMessage = async (errorMessage: string) => {
        if (pendingUserMessageId === null && pendingAssistantMessageId === null) {
            return;
        }
        if (pendingUserMessageId !== null) {
            const userMessage = messages.value.find(message => message.id === pendingUserMessageId);
            if (userMessage) {
                userMessage.deliveryStatus = 'failed';
                userMessage.deliveryError = errorMessage;
            }
        }
        updatePendingMascotMessage(`接続エラー: ${errorMessage}`);
        pendingUserMessageId = null;
        pendingAssistantMessageId = null;
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
                } else if (wsEvent === 'chat-response') {
                    const { text, emotion } = data;

                    updatePendingMascotMessage(text);
                    
                    // 会話終了後、30秒間無操作が続いた場合にバックグラウンドで要約＆長期記憶マージを実行
                    if (compactionTimer) {
                        clearTimeout(compactionTimer);
                    }
                    compactionTimer = setTimeout(async () => {
                        try {
                            console.log('[Compaction] Idle timeout reached. Starting compaction & memory update...');
                            const mascotId = activeMascot.value?.id || 'default';
                            if (activeSessionId.value) {
                                await runCompaction(mascotId, activeSessionId.value);
                                await saveHistory();
                            }
                        } catch (compactionErr) {
                            console.error('[Compaction] Deferred compaction failed:', compactionErr);
                        } finally {
                            compactionTimer = null;
                        }
                    }, 30000);

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
                    const { action, task, categories, taskId } = data;
                    console.log('[useChatConnection] Task action received:', action, task, taskId);
                    const taskStore = useTaskStore();
                    if (action === 'deleteTask') {
                        if (taskId) {
                            taskStore.deleteTask(taskId);
                        }
                    } else if (task) {
                        taskStore.addTaskFromServer(task, categories);
                    }
                } else if (wsEvent === 'memo-action') {
                    const { action, memo, memoId } = data;
                    console.log('[useChatConnection] Memo action received:', action, memo, memoId);
                    const memoStore = useMemoStore();
                    if (action === 'delete') {
                        if (memoId) {
                            memoStore.deleteMemo(memoId);
                        }
                    } else if (memo) {
                        if (action === 'add') {
                            const exists = memoStore.memos.findIndex(m => m.id === memo.id);
                            if (exists >= 0) {
                                memoStore.memos[exists] = memo;
                            } else {
                                memoStore.memos.push(memo);
                            }
                            memoStore.saveToLocalStorage();
                        } else if (action === 'update') {
                            const index = memoStore.memos.findIndex(m => m.id === memo.id);
                            if (index >= 0) {
                                memoStore.memos[index] = memo;
                                memoStore.saveToLocalStorage();
                            }
                        }
                    }
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
        const currentSocket = socket;
        socket = null;
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
        const retryTarget = retryMessageId !== undefined
            ? messages.value.find(message => message.id === retryMessageId && message.sender === 'user')
            : undefined;
        if (retryMessageId !== undefined && (!retryTarget || retryTarget.deliveryStatus !== 'failed')) return;
        if (!isActiveTalk && !retryTarget && !inputText.value.trim() && pendingAttachments.value.length === 0) return;
        if (isAiResponding.value) return;

        // 会話継続のため、予定されていた要約処理タイマーをクリアして延期する
        if (compactionTimer) {
            clearTimeout(compactionTimer);
            compactionTimer = null;
            console.log('[Compaction] User sent a message. Compaction deferred.');
        }

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
                    id: Date.now(),
                    sender: 'user',
                    text: userQuery,
                    timestamp: Date.now(),
                    attachments: attachments.length > 0 ? attachments : undefined,
                    deliveryStatus: 'sending'
                };
                messages.value.push(userMessage);
            }
        }

        const historyBase = isActiveTalk
            ? messages.value
            : messages.value.filter(message => message.id !== userMessage?.id && message.id !== userMessage?.responseMessageId);
        const historyToSend = historyBase
            .filter(m => (m.sender === 'user' && !m.deliveryStatus) || (m.sender === 'mascot' && m.text !== '考え中...' && !m.text.startsWith('接続に失敗しました') && !m.text.startsWith('サーバーに接続されていません') && !m.text.startsWith('接続エラー')))
            .slice(-10)
            .map(m => ({ sender: m.sender, text: m.text }));

        mascotStore.setLoading(true);

        await nextTick();
        scrollToBottom();

        const mascot = activeMascot.value;
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

        let systemPrompt = '';

        // マスコットの基礎情報
        if (mascot && mascot.profile) {
            systemPrompt += `# Mascot Character Profile\n${mascot.profile}\n\n`;
        }

        // ラジオモードプロンプト
        if (mascotStore.isRadioMode) {
            systemPrompt += await useRadioMode(isActiveTalk, configStore);
        }

        // マスコット固有のプロンプト
        if (window.electronAPI && window.electronAPI.getMascotPrompts && mascot) {
            try {
                const mascotPrompts = await window.electronAPI.getMascotPrompts(mascot.id);
                if (mascotPrompts.identity) {
                    systemPrompt += `# Mascot Identity\n${mascotPrompts.identity}\n\n`;
                }
                if (mascotPrompts.soul) {
                    systemPrompt += `# Mascot Soul / Tone / Personality\n${mascotPrompts.soul}\n\n`;
                }
                if (mascotPrompts.user) {
                    systemPrompt += `# User Context & Relations\n${mascotPrompts.user}\n\n`;
                }
                if (mascotPrompts.agents) {
                    systemPrompt += `# Mascot Rules & Action Guidelines\n${mascotPrompts.agents}\n\n`;
                }
                if (mascotPrompts.memory) {
                    systemPrompt += `# Mascot Long-term Memory\n${mascotPrompts.memory}\n\n`;
                }
            } catch (e) {
                console.error('Failed to load mascot prompts via IPC:', e);
            }
        }

        // システムプロンプトが空の場合、デフォルトのシステムプロンプトを設定する
        if (!systemPrompt.trim()) {
            systemPrompt = `あなたは対話型のAIデスクトップマスコットです。親しみやすく返答してください。`;
        }

        // 感情表現ブロック(Irodori-TTSのみ)
        if (useTts.value && voiceEngine === 'irodori') {
            systemPrompt += useIrodoriEmotion();
        }
        // 感情タグブロック(マスコットの表情向け)
        systemPrompt += "\n# System Instructions\n回答の最後に、自分の現在の感情に合わせて [happy], [sad], [angry], [surprised], [neutral] のいずれかの感情タグを必ず1つ含めて終了してください。例:「こんにちは！ [happy]」";

        // タイマー指定ブロック（マスコットの一時的リマインド専用。ユーザーのタスク一覧には保存されない）
        if (!systemPrompt.includes('[TIMER:')) {
            systemPrompt += "\n# Timer Instructions\nユーザーから「〇分後に教えて」「後でお知らせして」「カップラーメンにお湯を入れた（できたら教えて）」など、その場限りで一度だけ知らせればよい一時的なリマインドを求められた場合は、会話の応答テキストの末尾（感情タグの直前）に、必ず次のフォーマットでタイマー起動タグを付与してください。\n[TIMER:秒数,お知らせ内容]\n※秒数は半角数字で指定してください。お知らせ内容には具体的なリマインド内容を記述してください。例:「了解、3分測るね。[TIMER:180,カップラーメンができました！] [happy]」\n【重要な区別】このタイマーは一度きりの通知専用で、ユーザーのタスク一覧（TODO/予定）には保存されません。したがって『N分後に通知』などの一時的リマインドは manageTasks ツールでは登録しないでください。逆に、ユーザーが後から一覧で管理・確認したいTODOや予定（例:『明日15時に会議』『レポートを書く』）は、このタイマータグではなく必ず manageTasks ツールで登録してください。\n【履歴の扱い】会話履歴に含まれる過去のタイマー依頼は既に対応済みです。最新（今回）のメッセージで新たに『N分後に…』と頼まれたときだけタイマータグを付けてください。過去の履歴に依頼が残っていることを理由に、タイマーを再設定しないでください。";
        }

        if (!toolUseEnabled) {
            systemPrompt += '\n\n# ツール利用制限\n今回はすべてのツールが無効です。タスクやメモの操作、検索などを実行したと装わず、利用できないことを伝えてください。一時的なタイマータグは引き続き利用できます。';
        }

        const currentSession = sessions.value.find(s => s.id === activeSessionId.value);
        if (currentSession && currentSession.summary) {
            systemPrompt += `\n\n# Previous Conversation Summary\n以下はこれまでのマスターとの会話履歴の要約です。この文脈を考慮して返答してください。\n${currentSession.summary}\n`;
        }

        let aiMessage = retryTarget?.responseMessageId !== undefined
            ? messages.value.find(message => message.id === retryTarget.responseMessageId && message.sender === 'mascot')
            : undefined;
        if (aiMessage) {
            aiMessage.text = '考え中...';
        } else {
            aiMessage = {
                id: Date.now() + 1,
                sender: 'mascot',
                text: '考え中...',
                timestamp: Date.now()
            };
            messages.value.push(aiMessage);
        }
        const aiMessageId = aiMessage.id;
        if (userMessage) {
            userMessage.responseMessageId = aiMessageId;
            pendingUserMessageId = userMessage.id;
        }
        pendingAssistantMessageId = aiMessageId;

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
                apiKey: apiKey,
                systemPrompt: systemPrompt,
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
                history: historyToSend,
                useTts: useTts.value,
                ttsReadNarrative: ttsReadNarrative.value,
                saveVoice: saveVoice.value,
                showVoiceLog: showVoiceLog.value,
                activeMascotId: activeMascot.value?.id || 'default',
                ttsDictionary: activeMascot.value?.aiConfig?.ttsDictionary,
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
        attachFiles,
        removeAttachment
    };
}
