// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WindowSettingsPanel from '../WindowSettingsPanel.vue';
import { useConfigStore } from '../../../store/config';

const mountPanel = () => mount(WindowSettingsPanel, {
    global: {
        stubs: {
            Card: {
                template: '<section><slot name="title" /><slot name="content" /></section>',
            },
            Select: true,
            Button: true,
            Slider: true,
            InputText: true,
        },
    },
});

describe('WindowSettingsPanel', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        window.electronAPI = undefined;
        vi.stubGlobal('confirm', vi.fn());
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ authenticated: false }),
        }));
    });

    it('activeTab - タブを選択すると対応する設定だけを表示すること', async () => {
        const wrapper = mountPanel();

        expect(wrapper.text()).toContain('ウィンドウモード設定');
        expect(wrapper.text()).not.toContain('チャットウィンドウ設定');

        const chatTab = wrapper.findAll('.tab-btn').find((button) => button.text().includes('チャット'));
        expect(chatTab).toBeDefined();
        await chatTab!.trigger('click');

        expect(chatTab!.attributes('aria-pressed')).toBe('true');
        expect(wrapper.text()).toContain('チャットウィンドウ設定');
        expect(wrapper.text()).not.toContain('ウィンドウモード設定');
    });

    it('activeTab - 統合モードのときだけ統合表示タブを表示すること', async () => {
        const configStore = useConfigStore();
        const wrapper = mountPanel();

        expect(wrapper.findAll('.tab-btn').some((button) => button.text().includes('統合表示'))).toBe(false);

        configStore.windowMode = 'integrated';
        await wrapper.vm.$nextTick();

        const integratedTab = wrapper.findAll('.tab-btn').find((button) => button.text().includes('統合表示'));
        expect(integratedTab).toBeDefined();
        await integratedTab!.trigger('click');
        expect(wrapper.text()).toContain('統合ウィンドウ設定');

        configStore.windowMode = 'split';
        await wrapper.vm.$nextTick();

        expect(wrapper.findAll('.tab-btn').some((button) => button.text().includes('統合表示'))).toBe(false);
        expect(wrapper.text()).toContain('ウィンドウモード設定');
    });
});
