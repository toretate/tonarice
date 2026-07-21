// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useTaskWidgetWindow } from '../task-management/composables/useTaskWidgetWindow';
import { useTaskStore } from '../../store/task';
import { useConfigStore } from '../../store/config';
import MemoWidget from '../MemoWidget.vue';

describe('Widget Resize IPC Behavior', () => {
    let mockResizeWindow: ReturnType<typeof vi.fn>;
    let mockResizeChatWindow: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        }));
        setActivePinia(createPinia());

        mockResizeWindow = vi.fn();
        mockResizeChatWindow = vi.fn();

        (window as any).electronAPI = {
            resizeWindow: mockResizeWindow,
            resizeChatWindow: mockResizeChatWindow
        };
    });

    describe('Task (useTaskWidgetWindow)', () => {
        const createPointerEvent = (type: string, init: Record<string, unknown>) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.entries(init).forEach(([key, value]) => {
                Object.defineProperty(event, key, { value });
            });
            return event;
        };

        it('スマホ表示ではintegratedモードでもチャット領域全体に重なること', () => {
            window.matchMedia = vi.fn().mockImplementation(() => ({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }));
            let result: any;
            const TestComponent = defineComponent({
                setup() {
                    result = useTaskWidgetWindow(
                        useTaskStore(),
                        useConfigStore(),
                        ref('integrated')
                    );
                    return () => null;
                }
            });
            const wrapper = mount(TestComponent);

            expect(result.isCompactOverlay.value).toBe(true);
            expect(result.widgetStyle.value).toMatchObject({ width: '100%', height: '100%' });

            wrapper.unmount();
        });

        it('integratedモードではタッチ操作でウィジェットを移動できること', () => {
            let result: any;
            const windowMode = ref('integrated');
            const TestComponent = defineComponent({
                setup() {
                    const taskStore = useTaskStore();
                    const configStore = useConfigStore();
                    result = useTaskWidgetWindow(taskStore, configStore, windowMode);
                    return () => null;
                }
            });
            const wrapper = mount(TestComponent);
            const target = document.createElement('header');

            result.startWidgetDrag(createPointerEvent('pointerdown', {
                target,
                pointerType: 'touch',
                isPrimary: true,
                button: 0,
                clientX: 700,
                clientY: 100
            }));
            window.dispatchEvent(createPointerEvent('pointermove', {
                pointerType: 'touch',
                isPrimary: true,
                clientX: 500,
                clientY: 300
            }));

            expect(result.widgetStyle.value.left).toBe('474px');
            expect(result.widgetStyle.value.top).toBe('278px');

            window.dispatchEvent(createPointerEvent('pointerup', {
                pointerType: 'touch',
                isPrimary: true
            }));
            wrapper.unmount();
        });

        it('standaloneモードの場合、resizeWindow IPCが呼び出され、ローカルstyleが更新されること', () => {
            let result: any;
            const windowMode = ref('standalone');
            const TestComponent = defineComponent({
                setup() {
                    const taskStore = useTaskStore();
                    const configStore = useConfigStore();
                    result = useTaskWidgetWindow(taskStore, configStore, windowMode);
                    return () => null;
                }
            });

            const wrapper = mount(TestComponent);

            const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
            result.initResize(mousedownEvent, 'right');

            const mousemoveEvent = new MouseEvent('mousemove', { clientX: 150, clientY: 100 });
            window.dispatchEvent(mousemoveEvent);

            expect(mockResizeWindow).toHaveBeenCalledWith({ width: 390, height: 480 });
            expect(result.widgetStyle.value.width).toBe('390px');

            window.dispatchEvent(new MouseEvent('mouseup'));
            wrapper.unmount();
        });

        it.each(['integrated', 'compact'] as const)(
            '%sモードの場合、resizeWindow IPCは呼び出されず、ローカルstyleのみ更新されること',
            (mode) => {
                let result: any;
                const windowMode = ref(mode);
                const TestComponent = defineComponent({
                    setup() {
                        const taskStore = useTaskStore();
                        const configStore = useConfigStore();
                        result = useTaskWidgetWindow(taskStore, configStore, windowMode);
                        return () => null;
                    }
                });

                const wrapper = mount(TestComponent);

                const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
                result.initResize(mousedownEvent, 'right');

                const mousemoveEvent = new MouseEvent('mousemove', { clientX: 150, clientY: 100 });
                window.dispatchEvent(mousemoveEvent);

                expect(mockResizeWindow).not.toHaveBeenCalled();
                expect(result.widgetStyle.value.width).toBe(mode === 'compact' ? '100%' : '390px');

                window.dispatchEvent(new MouseEvent('mouseup'));
                wrapper.unmount();
            }
        );
    });

    describe('Memo (MemoWidget 本体リサイズ検証)', () => {
        it('standaloneモードの場合、右端のハンドルドラッグで resizeWindow IPC が呼び出されること', async () => {
            const configStore = useConfigStore();
            configStore.windowMode = 'standalone' as any;

            const wrapper = mount(MemoWidget, {
                global: {
                    stubs: {
                        Button: true,
                        InputText: true,
                        Textarea: true
                    }
                }
            });

            const handle = wrapper.find('.resize-handle.right');
            expect(handle.exists()).toBe(true);

            await handle.trigger('mousedown', {
                clientX: 100,
                clientY: 100,
                button: 0,
                preventDefault: () => {},
                stopPropagation: () => {}
            });

            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 100 }));

            expect(mockResizeWindow).toHaveBeenCalledWith({ width: 390, height: 480 });

            window.dispatchEvent(new MouseEvent('mouseup'));
            wrapper.unmount();
        });

        it.each(['integrated', 'compact'] as const)(
            '%sモードの場合、ハンドルドラッグで resizeWindow IPC が呼び出されないこと',
            async (mode) => {
                const configStore = useConfigStore();
                configStore.windowMode = mode as any;

                const wrapper = mount(MemoWidget, {
                    global: {
                        stubs: {
                            Button: true,
                            InputText: true,
                            Textarea: true
                        }
                    }
                });

                const handle = wrapper.find('.resize-handle.right');
                if (handle.exists()) {
                    await handle.trigger('mousedown', {
                        clientX: 100,
                        clientY: 100,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });

                    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 100 }));

                    expect(mockResizeWindow).not.toHaveBeenCalled();

                    window.dispatchEvent(new MouseEvent('mouseup'));
                } else {
                    expect(mockResizeWindow).not.toHaveBeenCalled();
                }

                wrapper.unmount();
            }
        );
    });
});
