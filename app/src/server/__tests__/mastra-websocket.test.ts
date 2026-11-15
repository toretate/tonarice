import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    mastraGenerate: vi.fn(),
    legacyGenerate: vi.fn(),
    synthesize: vi.fn(),
    executeMemos: vi.fn(),
    executeTasks: vi.fn()
}));

vi.mock('h3', () => ({ defineWebSocketHandler: (handler: unknown) => handler }));
vi.mock('../mastra/mastra-chat-service', () => ({
    MastraChatService: { generateResponse: serviceMocks.mastraGenerate }
}));
vi.mock('../utils/chat-ai-service', () => ({
    ChatAiService: { generateResponse: serviceMocks.legacyGenerate }
}));
vi.mock('../utils/voice-ai-service', () => ({
    VoiceAiService: { synthesize: serviceMocks.synthesize }
}));
vi.mock('../utils/tool-executor', () => ({
    executeMemosTool: serviceMocks.executeMemos,
    executeTasksTool: serviceMocks.executeTasks
}));
vi.mock('../utils/tasks-service', () => ({ updateTaskInDb: vi.fn() }));
vi.mock('../middleware/auth', () => ({ authenticateUserToken: vi.fn() }));

import handler from '../routes/ws';

interface TestPeer {
    context: Record<string, unknown>;
    send: ReturnType<typeof vi.fn>;
}

function createPeer(): TestPeer {
    return {
        context: { userId: 'user-test' },
        send: vi.fn()
    };
}

async function sendChat(peer: TestPeer, overrides: Record<string, unknown> = {}): Promise<void> {
    const message = JSON.stringify({
        event: 'chat-send',
        data: {
            message: 'こんにちは',
            apiKey: 'sk-test-sensitive',
            systemPrompt: '親しみやすく返答',
            model: 'gpt-4o',
            engine: 'openai',
            history: [{ sender: 'user', text: '前の質問' }],
            useTts: false,
            ...overrides
        }
    });
    await (handler as any).message(peer, { text: () => message });
}

function sentEvents(peer: TestPeer): Array<{ event: string; data: Record<string, unknown> }> {
    return peer.send.mock.calls.map(([value]) => JSON.parse(value as string));
}

describe('WebSocketのMastra対話経路', () => {
    const originalFlag = process.env.MASTRA_CHAT_ENABLED;

    beforeEach(() => {
        serviceMocks.mastraGenerate.mockReset();
        serviceMocks.legacyGenerate.mockReset();
        serviceMocks.synthesize.mockReset();
        serviceMocks.executeMemos.mockReset();
        serviceMocks.executeTasks.mockReset();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        process.env.MASTRA_CHAT_ENABLED = 'true';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (originalFlag === undefined) delete process.env.MASTRA_CHAT_ENABLED;
        else process.env.MASTRA_CHAT_ENABLED = originalFlag;
    });

    it('message_機能フラグ有効時にMastra応答を既存チャットイベントへ接続すること', async () => {
        serviceMocks.mastraGenerate.mockResolvedValue('こんにちは！ [happy]');
        const peer = createPeer();

        await sendChat(peer, {
            attachments: [{ type: 'image', name: 'sample.png', url: 'data:image/png;base64,aGVsbG8=' }],
            tools: { toolsWeather: true, toolsWebSearch: true, toolsGpsLocation: true, toolsVolume: true, toolsAppLauncher: true }
        });

        expect(serviceMocks.mastraGenerate).toHaveBeenCalledOnce();
        expect(serviceMocks.mastraGenerate.mock.calls[0][0]).toMatchObject({
            message: 'こんにちは',
            history: [{ sender: 'user', text: '前の質問' }],
            attachments: [{ type: 'image', name: 'sample.png', url: 'data:image/png;base64,aGVsbG8=' }],
            weatherEnabled: true,
            webSearchEnabled: true,
            locationEnabled: true,
            volumeEnabled: true,
            appLauncherEnabled: true
        });
        expect(serviceMocks.legacyGenerate).not.toHaveBeenCalled();
        expect(sentEvents(peer)).toContainEqual({
            event: 'chat-response',
            data: { text: 'こんにちは！', speechText: 'こんにちは！', emotion: 'happy' }
        });
    });

    it('message_Mastraのメモ操作を認証ユーザーのDBと画面イベントへ接続すること', async () => {
        serviceMocks.executeMemos.mockResolvedValue(JSON.stringify({ success: true, action: 'add', id: 'memo-1', memo: { id: 'memo-1', content: '買い物' } }));
        serviceMocks.mastraGenerate.mockImplementation(async (params) => {
            const output = await params.executeDataTool('manageMemos', { action: 'add', content: '買い物' });
            params.onDataToolResult('manageMemos', { action: 'add', content: '買い物' }, output);
            return 'メモしました。';
        });
        const peer = createPeer();

        await sendChat(peer);

        expect(serviceMocks.executeMemos).toHaveBeenCalledWith('user-test', { action: 'add', content: '買い物' });
        expect(sentEvents(peer)).toContainEqual({
            event: 'memo-action',
            data: { action: 'add', memoId: 'memo-1', memo: { id: 'memo-1', content: '買い物' } }
        });
    });

    it('message_フラグ無効時と未対応エンジンでは既存経路を使うこと', async () => {
        serviceMocks.legacyGenerate.mockResolvedValue('既存応答 [neutral]');
        process.env.MASTRA_CHAT_ENABLED = 'false';
        await sendChat(createPeer());
        process.env.MASTRA_CHAT_ENABLED = 'true';
        await sendChat(createPeer(), { engine: 'unsupported' });

        expect(serviceMocks.legacyGenerate).toHaveBeenCalledTimes(2);
        expect(serviceMocks.mastraGenerate).not.toHaveBeenCalled();
    });

    it('message_LMStudio設定をMastraのモデル解決と応答へ渡すこと', async () => {
        serviceMocks.mastraGenerate.mockResolvedValue('ローカルモデルの応答');
        const peer = createPeer();

        await sendChat(peer, {
            engine: 'lmstudio', model: 'local-model', apiKey: '',
            lmstudioEndpoint: 'http://127.0.0.1:1234/v1/', repetitionPenalty: 1.2, enableThinking: false
        });

        expect(serviceMocks.legacyGenerate).not.toHaveBeenCalled();
        expect(serviceMocks.mastraGenerate).toHaveBeenCalledWith(expect.objectContaining({
            engine: 'lmstudio', modelId: 'local-model', enableThinking: false
        }));
        expect(sentEvents(peer).some(item => item.event === 'chat-response')).toBe(true);
    });

    it('message_LMStudioでツール無効時はデータ操作を含め全ツールを公開しないこと', async () => {
        serviceMocks.mastraGenerate.mockResolvedValue('応答');
        await sendChat(createPeer(), {
            engine: 'lmstudio', model: 'local-model', apiKey: '', toolUseEnabled: false,
            tools: { toolsWeather: true, toolsWebSearch: true, toolsGpsLocation: true, toolsVolume: true, toolsAppLauncher: true }
        });
        expect(serviceMocks.mastraGenerate).toHaveBeenCalledWith(expect.objectContaining({
            weatherEnabled: false, webSearchEnabled: false, locationEnabled: false,
            volumeEnabled: false, appLauncherEnabled: false, executeDataTool: undefined
        }));
    });

    it('message_旧経路でもLMStudioのツール無効設定を渡すこと', async () => {
        process.env.MASTRA_CHAT_ENABLED = 'false';
        serviceMocks.legacyGenerate.mockResolvedValue('応答');
        await sendChat(createPeer(), { engine: 'lmstudio', model: 'local-model', toolUseEnabled: false });
        expect(serviceMocks.legacyGenerate).toHaveBeenCalledWith(expect.objectContaining({ toolUseEnabled: false }));
    });

    it('message_Mastra応答を既存の音声イベントへ接続すること', async () => {
        serviceMocks.mastraGenerate.mockResolvedValue('こんにちは。 [happy]');
        serviceMocks.synthesize.mockResolvedValue({
            data: 'aGVsbG8=', codec: 'wav', extension: 'wav'
        });
        const peer = createPeer();

        await sendChat(peer, { useTts: true, showVoiceLog: false });
        await vi.waitFor(() => {
            expect(sentEvents(peer).some(item => item.event === 'chat-audio')).toBe(true);
        });

        expect(serviceMocks.synthesize).toHaveBeenCalled();
        expect(sentEvents(peer).map(item => item.event)).toContain('chat-response');
    });

    it('message_Mastra失敗時に認証情報をイベントやログへ出さないこと', async () => {
        serviceMocks.mastraGenerate.mockRejectedValue(new Error('request failed sk-test-sensitive'));
        const peer = createPeer();

        await sendChat(peer);

        const serialized = JSON.stringify(sentEvents(peer));
        expect(serialized).toContain('chat-error');
        expect(serialized).not.toContain('sk-test-sensitive');
        expect(serviceMocks.legacyGenerate).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('sk-test-sensitive');
    });

    it('close_接続終了時に実行中のMastra呼出しを中断すること', async () => {
        serviceMocks.mastraGenerate.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
                abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }));
        const peer = createPeer();

        const pending = sendChat(peer);
        await vi.waitFor(() => expect(serviceMocks.mastraGenerate).toHaveBeenCalledOnce());
        (handler as any).close(peer, {});
        await pending;

        expect(sentEvents(peer).map(item => item.event)).toEqual(['chat-status']);
    });
});
