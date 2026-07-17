// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MusicWidget from '../MusicWidget.vue';
import { useConfigStore } from '../../store/config';

describe('MusicWidget', () => {
    const createObjectURL = vi.fn(() => 'blob:music-test');
    const revokeObjectURL = vi.fn();

    beforeEach(() => {
        const pinia = createPinia();
        setActivePinia(pinia);
        localStorage.clear();
        window.location.hash = '#music';
        createObjectURL.mockClear();
        revokeObjectURL.mockClear();
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
        Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });
        Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
        Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('handleFiles_選択した音声をプレイリストへ追加すること', async () => {
        const wrapper = mount(MusicWidget, { global: { plugins: [createPinia()] } });
        const input = wrapper.get<HTMLInputElement>('input[type="file"]');
        const file = new File(['music'], 'Sample Artist - Sample Song.mp3', { type: 'audio/mpeg' });
        Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });

        await input.trigger('change');
        await flushPromises();

        expect(createObjectURL).toHaveBeenCalledWith(file);
        expect(input.attributes('webkitdirectory')).toBeDefined();
        expect(wrapper.text()).toContain('Sample Song');
        expect(wrapper.text()).toContain('Sample Artist');
        wrapper.unmount();
    });

    it('onUnmounted_作成したObjectURLを解放すること', async () => {
        const wrapper = mount(MusicWidget, { global: { plugins: [createPinia()] } });
        const input = wrapper.get<HTMLInputElement>('input[type="file"]');
        Object.defineProperty(input.element, 'files', {
            configurable: true,
            value: [new File(['music'], 'Sample Song.wav', { type: 'audio/wav' })]
        });

        await input.trigger('change');
        await flushPromises();
        wrapper.unmount();

        expect(revokeObjectURL).toHaveBeenCalledWith('blob:music-test');
    });

    it('widgetStyle_統合モードでは画面下部の横長表示になること', () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        useConfigStore().windowMode = 'integrated';
        window.location.hash = '#integrated';

        const wrapper = mount(MusicWidget, { global: { plugins: [pinia] } });

        expect(wrapper.get('.music-widget').classes()).toContain('integrated');
        expect(wrapper.get<HTMLElement>('.music-widget').element.style.bottom).toBe('12px');
        expect(wrapper.get<HTMLElement>('.music-widget').element.style.width).toBe('auto');
        wrapper.unmount();
    });

    it('compactPlayer_コンパクトモードでは1行の操作だけを表示すること', () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        useConfigStore().windowMode = 'compact';
        window.location.hash = '#compact';

        const wrapper = mount(MusicWidget, { global: { plugins: [pinia] } });

        expect(wrapper.find('.compact-player-row').exists()).toBe(true);
        expect(wrapper.find('.widget-header').exists()).toBe(false);
        expect(wrapper.findAll('.compact-control')).toHaveLength(2);
        wrapper.unmount();
    });
});
