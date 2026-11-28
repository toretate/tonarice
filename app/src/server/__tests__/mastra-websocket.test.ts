import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    mastraGenerate: vi.fn(),
    synthesize: vi.fn(),
    executeMemos: vi.fn(),
    executeTasks: vi.fn()
}));

vi.mock('h3', () => ({ defineWebSocketHandler: (handler: unknown) => handler }));
vi.mock('../mastra/mastra-chat-service', () => ({
    MastraChatService: { generateResponse: serviceMocks.mastraGenerate }
}));
vi.mock('../utils/voice-ai-service', () => ({
    VoiceAiService: { synthesize: serviceMocks.synthesize }
}));
vi.mock('../utils/tool-executor', () => ({
    executeMemosTool: serviceMocks.executeMemos,
    executeTasksTool: serviceMocks.executeTasks
}));
vi.mock('../utils/tasks-service', () => ({ updateTaskInDb: vi.fn() }));
vi.mock('../utils/better-auth-runtime', () => ({ requireBetterAuthSession: vi.fn().mockResolvedValue({ user: { id: 'user-test' }, session: { id: 'test-session' } }) }));
vi.mock('../mastra/tool-approval', () => ({ requestToolApproval: vi.fn().mockResolvedValue(true), respondToolApproval: vi.fn() }));
vi.mock('../mastra/mutation-claim', () => ({ claimMutation: vi.fn().mockReturnValue(true) }));

import handler from '../routes/ws';
import { requestToolApproval } from '../mastra/tool-approval';
import { claimMutation } from '../mastra/mutation-claim';
import * as memoryStore from '../mastra/memory-store';
import { listMemorySessions } from '../mastra/memory-history';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

interface TestPeer {
    context: Record<string, unknown>;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    request: { headers: Headers };
}

function createPeer(): TestPeer {
    return {
        context: { userId: 'user-test' },
        request: { headers: new Headers() },
        close: vi.fn(),
        send: vi.fn()
    };
}

async function sendChat(peer: TestPeer, overrides: Record<string, unknown> = {}): Promise<void> {
    const message = JSON.stringify({
        event: 'chat-send',
        data: {
            message: 'こんにちは',
            turnId: 'session-1:message-1',
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


    beforeEach(() => {
        vi.stubEnv('ALLOW_AUTH_BYPASS', 'false');
        serviceMocks.mastraGenerate.mockReset();
        serviceMocks.synthesize.mockReset();
        serviceMocks.executeMemos.mockReset();
        serviceMocks.executeTasks.mockReset();
        vi.mocked(requestToolApproval).mockReset().mockResolvedValue(true);
        vi.mocked(claimMutation).mockReset().mockReturnValue(true);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('message_Memoryで履歴を読み書きし同じ再送でツール付き生成を繰り返さないこと', async () => {
        const storage = new LibSQLStore({ id: 'ws-memory-test', url: ':memory:' });
        const memory = new Memory({ storage });
        vi.spyOn(memoryStore, 'getMemoryStore').mockReturnValue({ memory, storage });
        serviceMocks.mastraGenerate.mockResolvedValue('了解 [happy]');
        const peer = createPeer();
        const base = { activeMascotId: 'mascot-test', memorySessionId: 'session-memory' };
        const first = { ...base, message: '青いリボン', memoryUserMessageId: 1000, memoryAssistantMessageId: 1001 };
        try {
            await sendChat(peer, first);
            expect(serviceMocks.mastraGenerate.mock.calls[0][0].history).toEqual([]);
            await sendChat(peer, first);
            expect(serviceMocks.mastraGenerate).toHaveBeenCalledTimes(1);
            await sendChat(peer, { ...base, memoryUserMessageId: 1002, memoryAssistantMessageId: 1003 });
            expect(serviceMocks.mastraGenerate.mock.calls[1][0].history).toEqual([
                { sender: 'user', text: '青いリボン' }, { sender: 'mascot', text: '了解' }
            ]);
            expect((await listMemorySessions(memory, 'user-test', 'mascot-test'))[0]?.messages).toHaveLength(4);
        } finally {
            await storage.close();
        }
    });

    it('message_Mastra応答を既存チャットイベントへ接続すること', async () => {
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
        expect(sentEvents(peer)).toContainEqual({
            event: 'chat-response',
            data: { text: 'こんにちは！', speechText: 'こんにちは！', emotion: 'happy' }
        });
    });

    it('message_OpenAIでツール無効時にすべてのツールを公開しないこと', async () => {
        serviceMocks.mastraGenerate.mockResolvedValue('了解');
        await sendChat(createPeer(), {
            toolUseEnabled: false,
            tools: { toolsWeather: true, toolsWebSearch: true, toolsGpsLocation: true, toolsVolume: true, toolsAppLauncher: true }
        });
        expect(serviceMocks.mastraGenerate.mock.calls[0][0]).toMatchObject({
            weatherEnabled: false, webSearchEnabled: false, locationEnabled: false,
            volumeEnabled: false, appLauncherEnabled: false, executeDataTool: undefined
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

    it('message_承認を拒否されたデータ変更は記録も実行もしないこと', async () => {
        vi.mocked(requestToolApproval).mockResolvedValue(false);
        serviceMocks.mastraGenerate.mockImplementation(async params => {
            const result = await params.executeDataTool('manageMemos', { action: 'add', content: '試験' });
            expect(JSON.parse(result)).toMatchObject({ success: false });
            return '変更しませんでした。';
        });
        await sendChat(createPeer());
        expect(claimMutation).not.toHaveBeenCalled();
        expect(serviceMocks.executeMemos).not.toHaveBeenCalled();
    });

    it('message_承認待ちで切断された後に承認が届いても変更しないこと', async () => {
        let approve!: (value: boolean) => void;
        vi.mocked(requestToolApproval).mockImplementation(() => new Promise(resolve => { approve = resolve; }));
        serviceMocks.mastraGenerate.mockImplementation(async params => {
            await params.executeDataTool('manageMemos', { action: 'add', content: '試験' });
            return '完了';
        });
        const peer = createPeer();
        const pending = sendChat(peer);
        await vi.waitFor(() => expect(approve).toBeDefined());
        (handler as any).close(peer, {});
        approve(true);
        await pending;
        expect(claimMutation).not.toHaveBeenCalled();
        expect(serviceMocks.executeMemos).not.toHaveBeenCalled();
        expect(sentEvents(peer).map(item => item.event)).toEqual(['chat-status']);
    });

    it('message_試行済みの変更は承認後でも再実行しないこと', async () => {
        vi.mocked(claimMutation).mockReturnValue(false);
        serviceMocks.mastraGenerate.mockImplementation(async params => {
            const result = await params.executeDataTool('manageTasks', { action: 'delete', id: 'task-1' });
            expect(JSON.parse(result)).toMatchObject({ success: false });
            return '結果を確認してください。';
        });
        await sendChat(createPeer());
        expect(serviceMocks.executeTasks).not.toHaveBeenCalled();
    });

    it('message_ツール状態を入力や結果を含めずチャットへ通知すること', async () => {
        serviceMocks.mastraGenerate.mockImplementation(async params => {
            params.onToolStatus('searchWeb', 'started');
            params.onToolStatus('searchWeb', 'failed');
            return '検索できませんでした。';
        });
        const peer = createPeer();
        await sendChat(peer);
        expect(sentEvents(peer)).toContainEqual({ event: 'tool-status', data: { name: 'searchWeb', status: 'started' } });
        expect(sentEvents(peer)).toContainEqual({ event: 'tool-status', data: { name: 'searchWeb', status: 'failed' } });
    });

    it('message_処理終了後の遅れたツール通知を送らないこと', async () => {
        let request: any;
        serviceMocks.mastraGenerate.mockImplementation(async params => { request = params; return '完了'; });
        const peer = createPeer();
        await sendChat(peer);
        const count = sentEvents(peer).length;
        request.onToolStatus('manageMemos', 'succeeded');
        request.onDataToolResult('manageMemos', { action: 'add' }, JSON.stringify({ success: true, id: 'memo-1', memo: {} }));
        expect(sentEvents(peer)).toHaveLength(count);
    });

    it('message_未対応エンジンではモデルを呼ばずエラーを返すこと', async () => {
        const peer = createPeer();
        await sendChat(peer, { engine: 'unsupported' });
        expect(serviceMocks.mastraGenerate).not.toHaveBeenCalled();
        expect(sentEvents(peer).map(item => item.event)).toContain('chat-error');
    });

    it('message_LMStudio設定をMastraのモデル解決と応答へ渡すこと', async () => {
        serviceMocks.mastraGenerate.mockResolvedValue('ローカルモデルの応答');
        const peer = createPeer();

        await sendChat(peer, {
            engine: 'lmstudio', model: 'local-model', apiKey: '',
            lmstudioEndpoint: 'http://127.0.0.1:1234/v1/', repetitionPenalty: 1.2, enableThinking: false
        });

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

    it('message_廃止した環境変数がfalseでもMastraを使うこと', async () => {
        vi.stubEnv('MASTRA_CHAT_ENABLED', 'false');
        try {
            serviceMocks.mastraGenerate.mockResolvedValue('応答');
            await sendChat(createPeer());
            expect(serviceMocks.mastraGenerate).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllEnvs();
        }
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
