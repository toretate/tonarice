// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoWorkPanel from '../CoWorkPanel.vue';

const fetchMock = vi.fn();
const data = { tasks: [], runs: [], scope: 'account-scope', account: 'account@example.test' };
let wrapper: VueWrapper;

describe('CoWorkPanel', () => {
    beforeEach(() => {
        fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify(data)));
        vi.stubGlobal('fetch', fetchMock);
        wrapper = mount(CoWorkPanel);
    });

    afterEach(() => {
        wrapper.unmount();
        vi.unstubAllGlobals();
    });

    it('loadData_認証付きの共通 API から定期タスクを読み込む', async () => {
        await flushPromises();
        expect(fetchMock).toHaveBeenCalledWith('/api/cowork', expect.objectContaining({ credentials: 'include' }));
        expect(wrapper.text()).toContain('作業をまとめて進める');
        expect(wrapper.text()).toContain('実行結果はまだありません。');
    });

    it('activeSection_メニューからスケジュール画面へ切り替える', async () => {
        const scheduleButton = wrapper.get('[aria-label="スケジュール"]');
        await scheduleButton.trigger('click');
        expect(wrapper.get('#scheduled-task-heading').text()).toBe('登録済みタスク');
        expect(scheduleButton.attributes('aria-current')).toBe('page');
    });

    it('設定_メニューからアカウントのAI設定を読み込みAPIキーを表示せずに保存する', async () => {
        await flushPromises();
        const stored = {
            engine: 'gemini', model: 'current-model', source: 'saved', hasApiKey: true, configured: true
        };
        fetchMock.mockImplementation(async (path, options) => new Response(JSON.stringify(path === '/api/cowork/settings'
            ? { ...stored, model: options.method === 'PUT' ? 'next-model' : stored.model }
            : path === '/api/cowork/models' ? { models: [], preferredModel: '', status: 'missing-key' } : data)));

        const button = wrapper.get('[aria-label="設定"]');
        await button.trigger('click');
        await flushPromises();
        expect(button.attributes('aria-current')).toBe('page');
        expect(wrapper.get('h2').text()).toBe('CoWork の設定');
        expect(wrapper.find('input[type="password"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('接続先のメイン設定');
        await wrapper.get('input[name="model"]').setValue('next-model');
        await wrapper.get('.ai-settings-form').trigger('submit');
        await flushPromises();

        const [, request] = fetchMock.mock.calls.find(([path, options]) => path === '/api/cowork/settings' && options.method === 'PUT')!;
        expect(request.headers.get('x-cowork-scope')).toBe(data.scope);
        expect(JSON.parse(request.body)).toEqual({ engine: 'gemini', model: 'next-model' });
        expect(wrapper.text()).toContain('設定を保存しました。');
    });

    it('設定_未設定のアカウントにもAIサービスとモデルの入力欄を表示する', async () => {
        await flushPromises();
        fetchMock.mockImplementation(async path => new Response(JSON.stringify(path === '/api/cowork/models'
            ? { models: [], preferredModel: '', status: 'missing-key' }
            : { engine: null, model: '', source: 'environment', hasApiKey: false, configured: false })));
        await wrapper.get('[aria-label="設定"]').trigger('click');
        await flushPromises();

        expect(wrapper.text()).toContain('未設定');
        expect(wrapper.get('legend').text()).toBe('実行に使う AI');
        expect(wrapper.get<HTMLSelectElement>('select[name="engine"]').element.value).toBe('gemini');
        expect(wrapper.get<HTMLInputElement>('input[name="model"]').element.value).toBe('');
        expect(wrapper.get('button[type="submit"]').text()).toBe('設定を保存');
    });

    it('設定_AIサービスを切り替えると候補を読み込みメイン設定のモデルを選ぶ', async () => {
        await flushPromises();
        fetchMock.mockImplementation(async (path, options) => {
            if (path === '/api/cowork/models') {
                const { engine } = JSON.parse(options.body);
                return new Response(JSON.stringify(engine === 'openai'
                    ? { models: ['gpt-example', 'gpt-other'], preferredModel: 'gpt-example', status: 'ready' }
                    : { models: ['gemini-old'], preferredModel: 'gemini-old', status: 'ready' }));
            }
            return new Response(JSON.stringify({ engine: null, model: '', source: 'environment', hasApiKey: false, configured: false }));
        });
        await wrapper.get('[aria-label="設定"]').trigger('click');
        await flushPromises();
        expect(wrapper.get<HTMLSelectElement>('select[name="model"]').element.value).toBe('gemini-old');

        await wrapper.get('select[name="engine"]').setValue('openai');
        await flushPromises();
        const select = wrapper.get<HTMLSelectElement>('select[name="model"]');
        expect(select.element.value).toBe('gpt-example');
        expect(select.text()).toContain('gpt-other');
        expect(select.text()).not.toContain('gemini-old');
    });

    it('submitForm_タスクをログイン中のアカウントに登録する', async () => {
        await flushPromises();
        await wrapper.get('.primary-button').trigger('click');
        await wrapper.get('#cowork-task-name').setValue('朝の確認');
        await wrapper.get('#cowork-task-prompt').setValue('今日の予定を確認してください。');
        await wrapper.get('.task-form').trigger('submit');
        await vi.waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/api/cowork/tasks')).toBe(true));
        const [, request] = fetchMock.mock.calls.find(([path]) => path === '/api/cowork/tasks')!;
        expect(request.method).toBe('POST');
        expect(request.headers.get('x-cowork-scope')).toBe(data.scope);
        expect(JSON.parse(request.body)).toMatchObject({
            name: '朝の確認',
            prompt: '今日の予定を確認してください。',
            schedule: { type: 'daily', intervalDays: 1, time: '09:00' },
            enabled: true
        });
    });
});
