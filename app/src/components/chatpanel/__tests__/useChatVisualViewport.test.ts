// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTextEntryElement, useChatVisualViewport } from '../useChatVisualViewport';

describe('useChatVisualViewport', () => {
    const listeners = new Map<string, EventListener>();

    beforeEach(() => {
        listeners.clear();
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            value: {
                addEventListener: vi.fn((type: string, listener: EventListener) => {
                    listeners.set(type, listener);
                }),
                removeEventListener: vi.fn((type: string) => {
                    listeners.delete(type);
                })
            }
        });
    });

    it('テキスト入力要素だけを判定すること', () => {
        expect(isTextEntryElement(document.createElement('textarea'))).toBe(true);
        expect(isTextEntryElement(document.createElement('input'))).toBe(true);
        expect(isTextEntryElement(document.createElement('button'))).toBe(false);
        expect(isTextEntryElement(null)).toBe(false);
    });

    it('入力中にVisualViewportが変化した場合は最新メッセージへスクロールすること', async () => {
        const scrollToBottom = vi.fn();
        const TestComponent = defineComponent({
            setup() {
                useChatVisualViewport(scrollToBottom);
                return () => null;
            }
        });
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.focus();
        const wrapper = mount(TestComponent);

        listeners.get('resize')?.(new Event('resize'));
        await nextTick();

        expect(scrollToBottom).toHaveBeenCalledOnce();

        wrapper.unmount();
        textarea.remove();
        expect(listeners.has('resize')).toBe(false);
    });

    it('入力中でなければViewport変化時もスクロール位置を維持すること', async () => {
        const scrollToBottom = vi.fn();
        const TestComponent = defineComponent({
            setup() {
                useChatVisualViewport(scrollToBottom);
                return () => null;
            }
        });
        const wrapper = mount(TestComponent);

        listeners.get('resize')?.(new Event('resize'));
        await nextTick();

        expect(scrollToBottom).not.toHaveBeenCalled();
        wrapper.unmount();
    });
});
