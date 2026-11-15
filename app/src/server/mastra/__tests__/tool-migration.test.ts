import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockModel } from '@mastra/core/test-utils/llm-mock';
import { MastraChatService } from '../mastra-chat-service';
import { resetMastraRuntimeForTest } from '../runtime';
import { createMascotRequestContext } from '../request-context';
import { mastraWebSearchTool } from '../web-search-tool';
import { mastraLocationTool } from '../location-tool';
import { mastraTasksTool, mastraMemosTool } from '../data-tools';
import { mastraAppLauncherTool, mastraVolumeTool } from '../desktop-tools';

const html = '<div class="result results_links results_links_deep web-result"><a class="result__a" href="https://example.com">ニュース</a><a class="result__snippet">概要</a></div>';

function createContext(overrides: Record<string, unknown> = {}) {
    return createMascotRequestContext({
        resolvedModel: {}, engine: 'gemini', modelId: 'test-model',
        ...overrides
    });
}

describe('Mastraツール移植のテスト', () => {
    const originalFlag = process.env.MASTRA_CHAT_ENABLED;

    beforeEach(() => {
        process.env.MASTRA_CHAT_ENABLED = 'true';
        resetMastraRuntimeForTest();
    });

    afterEach(() => {
        if (originalFlag === undefined) delete process.env.MASTRA_CHAT_ENABLED;
        else process.env.MASTRA_CHAT_ENABLED = originalFlag;
        resetMastraRuntimeForTest();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('generateResponse_設定された7ツールを公開し無効なツールを公開しないこと', async () => {
        const enabledCall = vi.fn();
        const disabledCall = vi.fn();
        await MastraChatService.generateResponse({
            message: 'こんにちは', systemPrompt: '', engine: 'gemini', modelId: 'test',
            resolvedModel: createMockModel({ mockText: 'はい', spyGenerate: enabledCall, version: 'v2' }),
            weatherEnabled: true, webSearchEnabled: true, locationEnabled: true,
            volumeEnabled: true, appLauncherEnabled: true,
            executeDataTool: async () => JSON.stringify({ success: true })
        });
        await MastraChatService.generateResponse({
            message: 'こんにちは', systemPrompt: '', engine: 'gemini', modelId: 'test',
            resolvedModel: createMockModel({ mockText: 'はい', spyGenerate: disabledCall, version: 'v2' })
        });

        const enabled = JSON.stringify(enabledCall.mock.calls[0]?.[0]);
        const disabled = JSON.stringify(disabledCall.mock.calls[0]?.[0]);
        for (const name of ['getWeather', 'searchWeb', 'getGPSLocation', 'adjustVolume', 'launchApp', 'manageTasks', 'manageMemos']) {
            expect(enabled).toContain(name);
            expect(disabled).not.toContain(name);
        }
    });

    it('execute_Web検索を一発話一回に制限し検索結果を返すこと', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => html });
        vi.stubGlobal('fetch', fetchMock);
        const context = createContext({ webSearchEnabled: true });
        if (!mastraWebSearchTool.execute) throw new Error('検索ツールがありません。');

        const first = await mastraWebSearchTool.execute({ query: 'ニュース' }, { requestContext: context } as never);
        const second = await mastraWebSearchTool.execute({ query: '別の検索' }, { requestContext: context } as never);

        expect(first).toMatchObject({ results: [{ title: 'ニュース', snippet: '概要', url: 'https://example.com/' }] });
        expect(second).toEqual({ error: 'この発話ではWeb検索を実行済みです。' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('generateResponse_モデルのWeb検索要求を実行して検索結果を次の生成へ渡すこと', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => html }));
        const model = createMockModel({ mockText: '未使用', version: 'v2' });
        const generate = vi.spyOn(model as { doGenerate: (options: unknown) => Promise<unknown> }, 'doGenerate');
        let count = 0;
        generate.mockImplementation(async () => {
            count += 1;
            return {
                content: count === 1
                    ? [{ type: 'tool-call', toolCallId: 'search-1', toolName: 'searchWeb', input: '{"query":"ニュース"}' }]
                    : [{ type: 'text', text: '検索結果はニュースです。' }],
                finishReason: count === 1 ? 'tool-calls' : 'stop',
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
                warnings: []
            };
        });

        const reply = await MastraChatService.generateResponse({
            message: 'ニュースを検索して', systemPrompt: '', resolvedModel: model,
            engine: 'gemini', modelId: 'test', webSearchEnabled: true
        });

        expect(reply).toBe('検索結果はニュースです。');
        expect(generate).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(generate.mock.calls[1]?.[0])).toContain('https://example.com');
    });

    it('execute_位置情報に失敗したとき東京を現在地として返さないこと', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-error')));
        if (!mastraLocationTool.execute) throw new Error('位置情報ツールがありません。');
        const result = await mastraLocationTool.execute({}, { requestContext: createContext({ locationEnabled: true }) } as never);
        expect(result).toEqual({ error: '位置情報の取得に失敗しました。' });
        expect(JSON.stringify(result)).not.toContain('東京');
        expect(JSON.stringify(result)).not.toContain('secret-error');
    });

    it('execute_軽量版検索のリンクと要約を抽出すること', async () => {
        const liteHtml = '<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews&amp;rut=abc" class=\'result-link\'>ニュース &amp; 情報</a><tr><td class=\'result-snippet\'>今日のニュース</td></tr>';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => liteHtml }));
        if (!mastraWebSearchTool.execute) throw new Error('検索ツールがありません。');

        const result = await mastraWebSearchTool.execute({ query: 'ニュース' }, {
            requestContext: createContext({ webSearchEnabled: true })
        } as never);

        expect(result).toEqual({ results: [{ title: 'ニュース & 情報', snippet: '今日のニュース', url: 'https://example.com/news' }] });
    });

    it('execute_位置情報の成功時は概算であることを明示すること', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ status: 'success', city: '大阪', lat: 34.7, lon: 135.5, country: '日本' })
        }));
        if (!mastraLocationTool.execute) throw new Error('位置情報ツールがありません。');

        const result = await mastraLocationTool.execute({}, {
            requestContext: createContext({ locationEnabled: true })
        } as never);

        expect(result).toMatchObject({ city: '大阪', latitude: 34.7, longitude: 135.5, accuracy: 'IPアドレスに基づく概算位置' });
    });

    it('execute_タスクとメモを認証済み実行関数へ委譲し画面通知を行うこと', async () => {
        const execute = vi.fn().mockResolvedValue(JSON.stringify({ success: true, action: 'add', id: 'task-1' }));
        const notify = vi.fn();
        const context = createContext({ executeDataTool: execute, onDataToolResult: notify });
        if (!mastraTasksTool.execute || !mastraMemosTool.execute) throw new Error('データツールがありません。');

        const task = await mastraTasksTool.execute({ action: 'add', title: '会議' }, { requestContext: context } as never);
        const memo = await mastraMemosTool.execute({ action: 'search', query: '買い物' }, { requestContext: context } as never);

        expect(task).toMatchObject({ success: true, id: 'task-1' });
        expect(memo).toMatchObject({ success: true });
        expect(execute).toHaveBeenCalledWith('manageTasks', { action: 'add', title: '会議' });
        expect(execute).toHaveBeenCalledWith('manageMemos', { action: 'search', query: '買い物' });
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('generateResponse_同じDB変更の並行呼び出しを一回に抑えること', async () => {
        const execute = vi.fn().mockResolvedValue(JSON.stringify({ success: true, action: 'add', id: 'memo-1' }));
        const model = createMockModel({ mockText: '未使用', version: 'v2' });
        const generate = vi.spyOn(model as { doGenerate: (options: unknown) => Promise<unknown> }, 'doGenerate');
        let count = 0;
        generate.mockImplementation(async () => {
            count += 1;
            return {
                content: count === 1
                    ? [
                        { type: 'tool-call', toolCallId: 'memo-1', toolName: 'manageMemos', input: '{"action":"add","content":"買い物"}' },
                        { type: 'tool-call', toolCallId: 'memo-2', toolName: 'manageMemos', input: '{"action":"add","content":"買い物"}' }
                    ]
                    : [{ type: 'text', text: 'メモを登録しました。' }],
                finishReason: count === 1 ? 'tool-calls' : 'stop',
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
                warnings: []
            };
        });

        const reply = await MastraChatService.generateResponse({
            message: '買い物とメモして', systemPrompt: '', resolvedModel: model,
            engine: 'gemini', modelId: 'test', executeDataTool: execute
        });

        expect(reply).toBe('メモを登録しました。');
        expect(execute).toHaveBeenCalledOnce();
        expect(JSON.stringify(generate.mock.calls[1]?.[0])).toContain('同じ変更を実行済み');
    });

    it('execute_データ実行関数がない場合はDBを操作しないこと', async () => {
        if (!mastraTasksTool.execute) throw new Error('タスクツールがありません。');
        const result = await mastraTasksTool.execute({ action: 'add', title: '会議' }, { requestContext: createContext() } as never);
        expect(result).toEqual({ success: false, error: 'データ管理ツールは利用できません。' });
    });

    it('execute_アプリ起動では任意コマンドを入力として受け付けないこと', () => {
        expect(mastraAppLauncherTool.inputSchema.safeParse({ appName: 'calc && whoami' }).success).toBe(false);
        expect(mastraAppLauncherTool.inputSchema.safeParse({ appName: '電卓' }).success).toBe(true);
    });

    it('execute_音量調整が無効ならPCを操作しないこと', async () => {
        if (!mastraVolumeTool.execute) throw new Error('音量ツールがありません。');
        const result = await mastraVolumeTool.execute({ volume: 50 }, { requestContext: createContext() } as never);
        expect(result).toEqual({ error: '音量調整は無効です。' });
    });

    it('execute_有効な音量調整を一発話一回に制限すること', async () => {
        if (!mastraVolumeTool.execute) throw new Error('音量ツールがありません。');
        const context = createContext({ volumeEnabled: true });

        const first = await mastraVolumeTool.execute({ volume: 50 }, { requestContext: context } as never);
        const second = await mastraVolumeTool.execute({ volume: 60 }, { requestContext: context } as never);

        expect(first).toEqual({ message: '音量を 50% に調整しました。' });
        expect(second).toEqual({ error: 'この発話では音量を調整済みです。' });
    });
});
