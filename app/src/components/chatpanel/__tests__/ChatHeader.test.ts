// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import ChatHeader from '../ChatHeader.vue';

const mountHeader = () => mount(ChatHeader, {
    props: {
        imageGenMode: null,
        showHistoryList: false,
        showTaskManagement: false,
        showMemoManagement: false,
        showMusicPlayer: false,
    },
});

describe('ChatHeader', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        window.electronAPI = undefined;
        window.location.hash = '#web';
    });

    it('モバイル操作メニューを開閉できること', async () => {
        const wrapper = mountHeader();
        const trigger = wrapper.get('[aria-label="その他の操作"]');

        expect(trigger.attributes('aria-expanded')).toBe('false');
        await trigger.trigger('click');

        expect(trigger.attributes('aria-expanded')).toBe('true');
        expect(wrapper.find('#mobile-chat-actions').exists()).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wrapper.vm.$nextTick();
        expect(wrapper.find('#mobile-chat-actions').exists()).toBe(false);
    });

    it('モバイル操作メニューからメモを切り替えるとメニューを閉じること', async () => {
        const wrapper = mountHeader();
        await wrapper.get('[aria-label="その他の操作"]').trigger('click');
        const memoButton = wrapper.findAll('#mobile-chat-actions button')
            .find((button) => button.text().includes('メモ'));

        expect(memoButton).toBeDefined();
        await memoButton!.trigger('click');

        expect(wrapper.emitted('update:showMemoManagement')).toEqual([[true]]);
        expect(wrapper.find('#mobile-chat-actions').exists()).toBe(false);
    });

    it('Web版で設定を選択すると設定画面へ遷移すること', async () => {
        const wrapper = mountHeader();
        await wrapper.get('[aria-label="その他の操作"]').trigger('click');
        const settingsButton = wrapper.findAll('#mobile-chat-actions button')
            .find((button) => button.text().trim() === '設定');

        expect(settingsButton).toBeDefined();
        await settingsButton!.trigger('click');

        expect(window.location.hash).toBe('#settings');
    });

    it('会話種別をCoWorkへ切り替えると更新イベントを通知すること', async () => {
        const wrapper = mountHeader();
        const select = wrapper.get('#conversation-kind');

        await select.setValue('cowork');

        expect(wrapper.emitted('update:conversationKind')).toEqual([['cowork']]);
    });

    it('CoWorkに未読件数を表示すること', async () => {
        const wrapper = mountHeader();
        await wrapper.setProps({ coworkUnreadCount: 3 });

        expect(wrapper.get('option[value="cowork"]').text()).toContain('CoWork (3)');
    });
});
