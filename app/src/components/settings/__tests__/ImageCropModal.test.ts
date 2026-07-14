// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ImageCropModal from '../mascot/ImageCropModal.vue';

describe('ImageCropModal', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('resolveImageUrl_BlobURLにはキャッシュバスターを付与しないこと', () => {
        const blobUrl = 'blob:http://localhost/crop-preview';
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        const wrapper = mount(ImageCropModal, {
            props: {
                visible: true,
                imageSrc: blobUrl
            },
            global: {
                stubs: {
                    Button: true
                }
            }
        });

        expect(wrapper.find('img').attributes('src')).toBe(blobUrl);

        wrapper.unmount();
        expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });
});
