// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatHeader from '../ChatHeader.vue';
import { useConfigStore } from '../../../store/config';

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

    it('画像生成メニューをボタンで操作できること', async () => {
        const wrapper = mountHeader();
        const trigger = wrapper.get('[aria-controls="image-generation-menu"]');

        await trigger.trigger('click');

        const items = wrapper.findAll('#image-generation-menu .menu-item');
        expect(items).toHaveLength(3);
        expect(items.every((item) => item.element.tagName === 'BUTTON')).toBe(true);

        await items[0].trigger('click');
        expect(wrapper.emitted('update:imageGenMode')).toEqual([['t2i']]);
    });

    it('アイコン操作にアクセシブルな名前と選択状態が設定されること', () => {
        const wrapper = mountHeader();
        const statefulLabels = [
            'マスコット表示を切り替える',
            'シークレットモードを切り替える',
            '音声読み上げを切り替える',
            'ラジオモードを切り替える',
            'メモを切り替える',
            '音楽プレイヤーを切り替える',
            'タスク管理を切り替える',
            '対話履歴を切り替える',
        ];

        for (const label of statefulLabels) {
            expect(wrapper.get(`[aria-label="${label}"]`).attributes('aria-pressed')).toMatch(/^(true|false)$/);
        }

        expect(wrapper.get('[aria-label="メモを切り替える"]').attributes('aria-pressed')).toBe('false');
        expect(wrapper.get('[aria-label="マスコット表示を切り替える"]').attributes('aria-pressed')).toBe('true');
        expect(wrapper.get('[aria-label="音楽プレイヤーを切り替える"]').attributes('aria-pressed')).toBe('false');
        expect(wrapper.get('[aria-label="タスク管理を切り替える"]').attributes('aria-pressed')).toBe('false');
        expect(wrapper.get('[aria-label="対話履歴を切り替える"]').attributes('aria-pressed')).toBe('false');
        expect(wrapper.get('[aria-label="画像生成・編集メニューを開く"]').attributes('aria-expanded')).toBe('false');
        expect(wrapper.get('[aria-label="新しい話題を開始する"]').element.tagName).toBe('BUTTON');
        expect(wrapper.get('[aria-label="設定を開く"]').element.tagName).toBe('BUTTON');
    });

    it('toggleMascot - マスコット表示ボタンで表示状態を切り替えて保存すること', async () => {
        const configStore = useConfigStore();
        configStore.windowMode = 'integrated';
        configStore.isLoaded = true;
        const saveSpy = vi.spyOn(configStore, 'saveConfig').mockResolvedValue(undefined as any);
        const wrapper = mountHeader();

        await wrapper.get('[aria-label="マスコット表示を切り替える"]').trigger('click');

        expect(configStore.mascotVisible).toBe(false);
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(wrapper.get('[aria-label="マスコット表示を切り替える"]').attributes('aria-pressed')).toBe('false');
    });
});
