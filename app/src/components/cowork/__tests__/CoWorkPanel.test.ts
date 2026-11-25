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
