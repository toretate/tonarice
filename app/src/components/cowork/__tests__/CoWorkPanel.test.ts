// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CoWorkPanel from '../CoWorkPanel.vue';

const getScheduledPromptData = vi.fn();
const createScheduledPromptTask = vi.fn();

describe('CoWorkPanel', () => {
    beforeEach(() => {
        getScheduledPromptData.mockReset().mockResolvedValue({
            tasks: [],
            runs: [],
            readOnly: false
        });
        createScheduledPromptTask.mockReset().mockResolvedValue({});
        window.electronAPI = {
            getScheduledPromptData,
            createScheduledPromptTask,
            onScheduledPromptChanged: vi.fn(() => () => {})
        } as any;
    });

    it('loadData_定期タスクがない場合に空表示を行う', async () => {
        const wrapper = mount(CoWorkPanel);
        await vi.waitFor(() => expect(getScheduledPromptData).toHaveBeenCalled());
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('作業をまとめて進める');
        expect(wrapper.text()).toContain('実行結果はまだありません。');

        const scheduleButton = wrapper.findAll('.nav-item')
            .find((button) => button.text().includes('スケジュール'));
        expect(scheduleButton).toBeDefined();
        await scheduleButton!.trigger('click');

        expect(wrapper.text()).toContain('定期タスクはまだありません。');
        expect(wrapper.text()).toContain('実行結果はまだありません。');
    });

    it('activeSection_メニューからスケジュール画面へ切り替える', async () => {
        const wrapper = mount(CoWorkPanel);
        const scheduleButton = wrapper.findAll('.nav-item')
            .find((button) => button.text().includes('スケジュール'));

        await scheduleButton!.trigger('click');

        expect(wrapper.get('#scheduled-task-heading').text()).toBe('登録済みタスク');
        expect(scheduleButton!.attributes('aria-current')).toBe('page');
    });

    it('submitForm_入力をプレーンオブジェクトとして登録する', async () => {
        const wrapper = mount(CoWorkPanel);
        await wrapper.get('.primary-button').trigger('click');
        await wrapper.get('#cowork-task-name').setValue('朝の確認');
        await wrapper.get('#cowork-task-prompt').setValue('今日の予定を確認してください。');
        await wrapper.get('.task-form').trigger('submit');
        await vi.waitFor(() => expect(createScheduledPromptTask).toHaveBeenCalled());

        expect(createScheduledPromptTask).toHaveBeenCalledWith(expect.objectContaining({
            name: '朝の確認',
            prompt: '今日の予定を確認してください。',
            schedule: {
                type: 'daily',
                intervalDays: 1,
                time: '09:00'
            },
            enabled: true
        }));
    });
});
