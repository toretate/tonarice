// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ImageGenerationFooter from '../ImageGenerationFooter.vue';
import { useConfigStore } from '../../../store/config';

describe('ImageGenerationFooter', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    test('表示内容_OpenAIのi2iではDenoiseを表示しないこと', () => {
        const configStore = useConfigStore();
        configStore.selectedImageEngine = 'openai_image';

        const wrapper = mount(ImageGenerationFooter, {
            props: { mode: 'i2i', isSecretMode: false }
        });

        expect(wrapper.find('.denoise-slider-box').exists()).toBe(false);
        expect(wrapper.find('.openai-i2i-note').text()).toContain('変更量はプロンプトで指定');
    });

    test('表示内容_Forgeのi2iではDenoiseを表示すること', () => {
        const configStore = useConfigStore();
        configStore.selectedImageEngine = 'sd_forge';

        const wrapper = mount(ImageGenerationFooter, {
            props: { mode: 'i2i', isSecretMode: false }
        });

        expect(wrapper.find('.denoise-slider-box').exists()).toBe(true);
        expect(wrapper.find('.openai-i2i-note').exists()).toBe(false);
    });

    test('表示内容_NanoBananaのi2iではプロンプト編集案内を表示すること', () => {
        const configStore = useConfigStore();
        configStore.selectedImageEngine = 'gemini_image';

        const wrapper = mount(ImageGenerationFooter, {
            props: { mode: 'i2i', isSecretMode: false }
        });

        expect(wrapper.find('.denoise-slider-box').exists()).toBe(false);
        expect(wrapper.find('.openai-i2i-note').text()).toContain('添付画像を参照して編集');
    });
});
