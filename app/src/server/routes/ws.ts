import { defineWebSocketHandler } from 'h3';
import * as fs from 'fs';
import * as path from 'path';
import { VoiceAiService } from '../utils/voice-ai-service';
import { splitSentences } from '../utils/sentence-splitter';
import { sanitizeForIrodoriTTS } from '../utils/irodori-sanitizer';
import { filterDialogue } from '../utils/dialogue-filter';
import { requireBetterAuthSession } from '../utils/better-auth-runtime';
import { normalizeTextForTts, stripResidualAsterisks } from '../utils/tts-normalizer';
import { PROJECT_ROOT, USERS_DIR } from '../utils/paths';
import { executeMemosTool, executeTasksTool } from '../utils/tool-executor';
import { loadTasksStateFromDb } from '../utils/tasks-service';
import { isAuthBypassAllowed } from '../utils/auth-bypass';
import { encodeAudioBinaryFrame } from '../../utils/audio-binary-frame';
import { MastraChatService } from '../mastra/mastra-chat-service';
import { resolveMastraChatModel } from '../mastra/model-resolver';
import { getMastraChatErrorMessage } from '../mastra/chat-route';
import { openChatMemoryTurn } from '../mastra/chat-memory-turn';
import { requestToolApproval, respondToolApproval } from '../mastra/tool-approval';
import { claimMutation } from '../mastra/mutation-claim';
import { addUserConnection, removeUserConnection, broadcastToUser, trackSessionConnection } from '../utils/user-connections';
import { GenerationBudget } from '../mastra/generation-budget';


// ユーザーごとの接続管理（crosswsのPeerオブジェクトをSetに保存）
const activeMastraRequests = new WeakMap<object, Set<AbortController>>();

function registerMastraRequest(peer: object, controller: AbortController): void {
    const requests = activeMastraRequests.get(peer) || new Set<AbortController>();
    requests.add(controller);
    activeMastraRequests.set(peer, requests);
}

function unregisterMastraRequest(peer: object, controller: AbortController): void {
    const requests = activeMastraRequests.get(peer);
    requests?.delete(controller);
    if (requests?.size === 0) activeMastraRequests.delete(peer);
}

function abortMastraRequests(peer: object): void {
    for (const controller of activeMastraRequests.get(peer) || []) {
        controller.abort();
    }
    activeMastraRequests.delete(peer);
}

function getPeerUserId(peer: { context: Record<string, unknown> }): string {
    const userId = peer.context.userId;
    return typeof userId === 'string' ? userId : 'anonymous';
}

/**
 * 認証済み接続のユーザーに限定してタスク・メモを操作する。
 */
async function executeDataToolForPeer(
    peer: { context: Record<string, unknown> },
    name: 'manageTasks' | 'manageMemos',
    input: Record<string, unknown>
): Promise<string> {
    const userId = getPeerUserId(peer);
    if (userId === 'anonymous') {
        return JSON.stringify({ success: false, error: '認証済みユーザーが必要です。' });
    }
    try {
        return name === 'manageMemos'
            ? await executeMemosTool(userId, input as never)
            : await executeTasksTool(userId, input as never);
    } catch {
        console.warn(`[WS] ${name}の実行に失敗`);
        return JSON.stringify({ success: false, error: 'データ操作に失敗しました。' });
    }
}

/**
 * ツールによるDB変更を既存の画面同期イベントへ変換する。
 */
function notifyDataToolResult(
    peer: { context: Record<string, unknown>; send: (message: string) => void },
    name: 'manageTasks' | 'manageMemos',
    input: Record<string, unknown>,
    output: unknown
): void {
    try {
        const result = typeof output === 'string' ? JSON.parse(output) : output;
        if (!result?.success) return;
        if (name === 'manageMemos') {
            peer.send(JSON.stringify({
                event: 'memo-action',
                data: {
                    action: input.action,
                    memoId: result.id || input.id,
                    memo: result.memo,
                    ...(result.revision !== undefined ? { revision: result.revision } : {})
                }
            }));
            return;
        }
        if (input.action === 'add' || input.action === 'update') {
            const state = Array.isArray(result.categories) && result.task
                ? { categories: result.categories, task: result.task }
                : (() => {
                    const loaded = loadTasksStateFromDb(getPeerUserId(peer));
                    return {
                        categories: loaded.categories,
                        task: result.task || loaded.tasks.find((t: any) => t.id === (result.id || input.id))
                    };
                })();
            peer.send(JSON.stringify({
                event: 'task-action',
                data: {
                    action: input.action === 'add' ? (input.scheduledAt ? 'addSchedule' : 'addTask') : 'updateTask',
                    categories: state.categories,
                    task: state.task,
                    ...(result.revision !== undefined ? { revision: result.revision } : {})
                }
            }));
        } else if (input.action === 'delete') {
            peer.send(JSON.stringify({
                event: 'task-action',
                data: {
                    action: 'deleteTask',
                    taskId: input.id,
                    ...(result.revision !== undefined ? { revision: result.revision } : {})
                }
            }));
        }
    } catch {
        console.warn(`[WS] ${name}の画面同期に失敗`);
    }
}


export default defineWebSocketHandler({
    async open(peer) {
        console.log('[WS] Client connecting via Nitro...');
        
        let userId = 'anonymous';
        try {
            if (isAuthBypassAllowed()) {
                userId = 'usr_local_dev_bypass';
                console.warn(`[WS] ALLOW_AUTH_BYPASS=true のため認証をバイパスします。User ID: ${userId}`);
            } else {
                const origin = peer.request.headers.get('origin');
                const allowedOrigin = process.env.BETTER_AUTH_URL && new URL(process.env.BETTER_AUTH_URL).origin;
                if (origin && origin !== allowedOrigin) {
                    peer.close(4003, '接続元が許可されていません。');
                    return;
                }
                const { user, session } = await requireBetterAuthSession(peer.request.headers);
                const disconnect = () => {
                    removeUserConnection(user.id, peer);
                    abortMastraRequests(peer);
                    peer.close(4001, 'セッションが無効です。');
                };
                const untrack = trackSessionConnection(session.id, disconnect);
                const timer = setInterval(async () => {
                    try {
                        const current = await requireBetterAuthSession(peer.request.headers);
                        if (current.user.id === user.id && current.session.id === session.id) return;
                    } catch { /* 失効・期限切れとして接続を終了する。 */ }
                    clearInterval(timer);
                    disconnect();
                }, 30_000);
                timer.unref();
                peer.context.releaseSession = () => {
                    clearInterval(timer);
                    untrack();
                };
                console.log(`[WS] Authentication successful for user: ${user.id}`);
                userId = user.id;
            }
        } catch (authError: any) {
            console.error('[WS] Authentication failed:', authError.message);
            peer.close(authError.statusCode === 403 ? 4003 : 4001, '認証に失敗しました。');
            return;
        }

        // コネクションの登録
        peer.context.userId = userId;
        addUserConnection(userId, peer);
        console.log(`[WS] Client connected successfully (User: ${userId})`);
    },

    async message(peer, msg) {
        const userId = getPeerUserId(peer);
        if (!isAuthBypassAllowed()) {
            try {
                const { user } = await requireBetterAuthSession(peer.request.headers);
                if (user.id !== userId) throw new Error('ユーザーが一致しません。');
            } catch {
                peer.close(4001, 'セッションが無効です。');
                return;
            }
        }
        try {
            const rawMessage = msg.text();
            const parsed = JSON.parse(rawMessage);
            const { event, data } = parsed;

            if (event === 'tool-approval-response') {
                respondToolApproval(peer, data?.id, data?.approved);
                return;
            }

            if (event === 'client-capabilities') {
                peer.context.binaryAudioV1 = data?.binaryAudioV1 === true;
                return;
            }

            if (event === 'chat-send') {
                const {
                    message,
                    apiKey,
                    systemPrompt,
                    model,
                    voicevoxSpeakerId,
                    voicevoxEndpoint,
                    selectedVoiceEngine,
                    irodoriEndpoint,
                    irodoriModel,
                    irodoriVoice,
                    irodoriLora,
                    irodoriSpeed,
                    irodoriCaption,
                    engine,
                    lmstudioEndpoint,
                    history,
                    useTts,
                    ttsReadNarrative,
                    saveVoice,
                    showVoiceLog,
                    attachments,
                    tools,
                    turnId,
                    toolUseEnabled,
                    temperature,
                    frequencyPenalty,
                    repetitionPenalty,
                    maxOutputTokens,
                    enableThinking,
                    ttsDictionary
                } = data;
                const enableTools = toolUseEnabled !== false;

                console.log(`=========================================`);
                console.log(`[WS] chat-send received (Nitro)!`);
                console.log(` - Engine: "${engine}"`);
                console.log(' - Chat route: mastra');
                console.log(` - Model: "${model}"`);
                console.log(` - Temperature: ${temperature}`);
                console.log(` - Frequency Penalty: ${frequencyPenalty}`);
                console.log(` - Repetition Penalty: ${repetitionPenalty}`);
                console.log(` - Max Output Tokens: ${maxOutputTokens}`);
                console.log(` - Enable Thinking: ${enableThinking}`);
                console.log(` - API Key: "${apiKey ? '***(設定あり)***' : '(設定なし)'}"`);
                console.log(` - LM Studio Endpoint: "${lmstudioEndpoint}"`);
                console.log(` - History elements: ${history ? history.length : 0}`);
                console.log(` - Attachments count: ${attachments ? attachments.length : 0}`);
                console.log(`=========================================`);

                // 1. 考え中ステータスをプッシュ
                peer.send(JSON.stringify({
                    event: 'chat-status',
                    data: { status: 'thinking' }
                }));

                let reply = '';
                const mastraController = new AbortController();
                const generationBudget = new GenerationBudget(mastraController.signal);
                let releaseMemory: (() => void) | undefined;
                registerMastraRequest(peer, mastraController);
                try {
                    const memoryTurn = await openChatMemoryTurn(userId, data);
                    if (memoryTurn.kind === 'rejected') {
                        peer.send(JSON.stringify({ event: 'chat-error', data: { message: memoryTurn.message } }));
                        return;
                    }
                    if (memoryTurn.kind === 'persistent') {
                        releaseMemory = memoryTurn.release;
                        if (memoryTurn.savedReply !== undefined) {
                            const text = memoryTurn.savedReply;
                            peer.send(JSON.stringify({ event: 'chat-response', data: { text, speechText: text, emotion: 'neutral' } }));
                            return;
                        }
                    }
                    const authorizeSideEffect = async (name: string, input: Record<string, unknown>): Promise<string | null> => {
                        if (typeof turnId !== 'string' || turnId.length < 1 || turnId.length > 200) {
                            return '操作識別子がないため変更できません。画面を更新してください。';
                        }
                        if (!await generationBudget.waitForApproval(() => requestToolApproval(peer, name, input, generationBudget.signal))) {
                            return 'ユーザーが承認しなかったため操作しませんでした。';
                        }
                        generationBudget.signal.throwIfAborted();
                        try {
                            if (!claimMutation(path.join(USERS_DIR, '.tool-mutation-claims'), getPeerUserId(peer), turnId, name, input)) {
                                return '同じ発話の操作は既に試行されています。再実行せず結果を確認してください。';
                            }
                        } catch {
                            return '操作記録を保存できないため実行しませんでした。';
                        }
                        return null;
                    };
                    const resolved = resolveMastraChatModel({
                        engine: engine || 'gemini',
                        model,
                        apiKey,
                        lmstudioEndpoint,
                        repetitionPenalty,
                        enableThinking
                    });
                    reply = await MastraChatService.generateResponse({
                        message,
                        systemPrompt,
                        resolvedModel: resolved.resolvedModel,
                        engine: resolved.engine,
                        modelId: resolved.modelId,
                        temperature,
                        frequencyPenalty,
                        maxOutputTokens,
                        history: memoryTurn.kind === 'persistent' ? memoryTurn.history : history,
                        attachments,
                        weatherEnabled: enableTools && tools?.toolsWeather === true,
                        webSearchEnabled: enableTools && tools?.toolsWebSearch === true,
                        locationEnabled: enableTools && tools?.toolsGpsLocation === true,
                        volumeEnabled: enableTools && tools?.toolsVolume === true,
                        appLauncherEnabled: enableTools && tools?.toolsAppLauncher === true,
                        enableThinking,
                        authorizeSideEffect,
                        executeDataTool: !enableTools || getPeerUserId(peer) === 'anonymous'
                            ? undefined
                            : async (name, input) => {
                                if (input.action === 'search') return executeDataToolForPeer(peer, name, input);
                                const refusal = await authorizeSideEffect(name, input);
                                if (refusal) return JSON.stringify({ success: false, error: refusal });
                                return executeDataToolForPeer(peer, name, input);
                            },
                        onDataToolResult: (name, input, output) => {
                            if (!generationBudget.signal.aborted) notifyDataToolResult(peer, name, input, output);
                        },
                        onToolStatus: (name, status) => {
                            if (!generationBudget.signal.aborted) peer.send(JSON.stringify({ event: 'tool-status', data: { name, status } }));
                        },
                        abortSignal: generationBudget.signal,
                        generationBudget
                    });
                    generationBudget.signal.throwIfAborted();
                    if (memoryTurn.kind === 'persistent') {
                        await memoryTurn.save(message, reply.replace(/\[TIMER:.*?\]/gi, '').replace(/\[\w+\]/g, '').trim(), attachments);
                    }
                } catch (aiError) {
                    if (mastraController.signal.aborted) return;
                    console.warn('[WS] Mastraチャットの処理に失敗');
                    peer.send(JSON.stringify({
                        event: 'chat-error',
                        data: { message: `AIサーバーとの通信エラー: ${getMastraChatErrorMessage(aiError, engine || 'gemini')}` }
                    }));
                    return;
                } finally {
                    generationBudget.dispose();
                    releaseMemory?.();
                    unregisterMastraRequest(peer, mastraController);
                }
                if (mastraController.signal.aborted) return;

                let timerData: { seconds: number; memo: string } | null = null;
                const timerMatch = reply.match(/\[TIMER:(\d+),(.+?)\]/i);
                if (timerMatch && timerMatch[1] && timerMatch[2]) {
                    timerData = {
                        seconds: parseInt(timerMatch[1], 10),
                        memo: timerMatch[2].trim()
                    };
                }

                const cleanReply = reply.replace(/\[TIMER:.*?\]/gi, '').trim();

                let detectedEmotion = 'neutral';
                const emotionMatch = cleanReply.match(/\[(\w+)\]/);
                if (emotionMatch && emotionMatch[1]) {
                    detectedEmotion = emotionMatch[1].toLowerCase().trim();
                }

                // 表情対応処理（detectedEmotionの抽出）を行ってから、表示用テキストと音声テキストから表情タグを除去
                const speechText = cleanReply.replace(/\[\w+\]/g, '').trim();

                peer.send(JSON.stringify({
                    event: 'chat-response',
                    data: {
                        text: speechText,
                        speechText: speechText,
                        emotion: detectedEmotion
                    }
                }));

                if (timerData) {
                    const durationMs = timerData.seconds * 1000;
                    console.log(`[WS] Timer registered for user ${userId}: ${timerData.seconds}s, Memo: "${timerData.memo}"`);
                    setTimeout(() => {
                        console.log(`[WS] Timer triggered for user ${userId}: "${timerData!.memo}"`);
                        broadcastToUser(userId, 'timer-trigger', {
                            memo: timerData!.memo
                        });
                    }, durationMs);
                }

                if (speechText && useTts !== false) {
                    const voiceEngine = selectedVoiceEngine || 'voicevox';
                    const baseUrl = voicevoxEndpoint || 'http://localhost:50021';
                    const speaker = voicevoxSpeakerId !== undefined ? voicevoxSpeakerId : 2;
                    const irodoriUrl = irodoriEndpoint || 'http://127.0.0.1:8088';
                    const irodoriModelName = irodoriModel || 'irodori-tts-500m-v3';
                    const irodoriVoiceName = irodoriVoice || 'default';

                    const normalized = normalizeTextForTts(speechText, ttsDictionary);
                    const dialogueFiltered = ttsReadNarrative === false ? filterDialogue(normalized) : normalized;
                    const targetSpeechText = stripResidualAsterisks(dialogueFiltered);

                    if (targetSpeechText.trim()) {
                        const processedSentences = splitSentences(targetSpeechText)
                            .map(sentence => voiceEngine === 'irodori' ? sanitizeForIrodoriTTS(sentence).trim() : sentence)
                            .filter(sentence => sentence.length > 0);

                        const synthPromises = processedSentences.map(sentence => {
                            if (voiceEngine === 'irodori') {
                                return irodoriLora
                                    ? VoiceAiService.synthesizeIrodori(sentence, irodoriUrl, irodoriModelName, irodoriVoiceName, detectedEmotion, showVoiceLog !== false, irodoriLora, irodoriSpeed, irodoriCaption)
                                    : VoiceAiService.synthesizeIrodori(sentence, irodoriUrl, irodoriModelName, irodoriVoiceName, detectedEmotion, showVoiceLog !== false, undefined, irodoriSpeed, irodoriCaption);
                            } else {
                                return VoiceAiService.synthesize(sentence, speaker, baseUrl, showVoiceLog !== false);
                            }
                        });

                        (async () => {
                            for (const promise of synthPromises) {
                                try {
                                    const audio = await promise;
                                    if (audio) {
                                        if (peer.context.binaryAudioV1 === true) {
                                            peer.send(encodeAudioBinaryFrame(Buffer.from(audio.data, 'base64'), audio.codec));
                                        } else {
                                            peer.send(JSON.stringify({
                                                event: 'chat-audio',
                                                data: { audio }
                                            }));
                                        }

                                        if (data.saveVoice) {
                                            try {
                                                const today = new Date();
                                                const yyyy = today.getFullYear();
                                                const mm = String(today.getMonth() + 1).padStart(2, '0');
                                                const dd = String(today.getDate()).padStart(2, '0');
                                                const dateStr = `${yyyy}${mm}${dd}`;

                                                const mascotId = data.activeMascotId || 'default';
                                                const dirPath = path.join(USERS_DIR, userId, 'mascots', mascotId, 'voices', dateStr);
                                                
                                                if (!fs.existsSync(dirPath)) {
                                                    fs.mkdirSync(dirPath, { recursive: true });
                                                }

                                                const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${audio.extension}`;
                                                const filePath = path.join(dirPath, filename);

                                                fs.writeFileSync(filePath, Buffer.from(audio.data, 'base64'));
                                                console.log(`[WS] Voice saved to: ${filePath}`);
                                            } catch (saveErr: any) {
                                                console.error('[WS] Failed to save voice file:', saveErr.message);
                                            }
                                        }
                                    }
                                } catch (err) {
                                    console.error('[WS] VOICEVOX並行合成エラー:', err);
                                }
                            }
                        })();
                    }
                }
            }
        } catch (e: any) {
            console.error('[WS] Error processing message:', e.message);
        }
    },

    close(peer, details) {
        const release = peer.context.releaseSession;
        if (typeof release === 'function') release();
        const userId = getPeerUserId(peer);
        abortMastraRequests(peer);
        console.log(`[WS] Client disconnected (User: ${userId}, Details: ${JSON.stringify(details)})`);
        removeUserConnection(userId, peer);
    }
});
