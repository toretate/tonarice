// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import IntegratedLayout from '../IntegratedLayout.vue';
import MascotViewer from '../../MascotViewer.vue';
import MessageList from '../../chatpanel/MessageList.vue';
import { useConfigStore } from '../../../store/config';
import { useMusicStore } from '../../../store/music';

// PixiJS のモック
vi.mock('pixi.js', () => {
    return {
        Application: class {
            init() { return Promise.resolve(); }
            stage = { addChild: () => {} };
            destroy() {}
        },
        Container: class {
            addChild() {}
            destroy() {}
        },
        Sprite: class {
            texture = {};
            anchor = { set: () => {} };
        },
        Assets: {
            load: () => Promise.resolve({ width: 100, height: 100 })
        },
        Texture: {
            EMPTY: {}
        }
    };
});

describe('IntegratedLayout.vue - 統合ウィンドウのテスト', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true, sessions: [] }) }));
        
        // window.electronAPI のモック
        window.electronAPI = {
            dragWindow: vi.fn(),
            setIgnoreMouseEvents: vi.fn(),
            toggleChat: vi.fn(),
            onTimerTrigger: vi.fn().mockReturnValue(() => {}),
            getAppConfig: vi.fn().mockResolvedValue({ 
                mascotScale: 1.0, 
                windowMode: 'integrated',
                integratedWidth: 1100,
                integratedHeight: 800
            }),
            onApplyPreviewState: vi.fn().mockReturnValue(() => {}),
            onChatToggled: vi.fn().mockReturnValue(() => {}),
            onEmotionChanged: vi.fn().mockReturnValue(() => {}),
            onConfigUpdated: vi.fn().mockReturnValue(() => {}),
        } as any;
    });

    afterEach(() => vi.unstubAllGlobals());

    it('IntegratedLayout_会話種別の切り替えで全幅表示にしチャットの分割幅を復元する', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.windowMode = 'integrated';
        configStore.integratedChatRatio = 0.42;
        const key = 'tonarice-conversation-kind';
        const previous = window.localStorage.getItem(key);
        window.localStorage.setItem(key, 'chat');
        const wrapper = mount(IntegratedLayout);

        try {
            const layout = wrapper.get('.integrated-container');
            const chat = wrapper.get<HTMLElement>('.chat-section').element;
            const mode = wrapper.get('#conversation-kind');
            expect(layout.classes()).not.toContain('is-cowork');

            await mode.setValue('cowork');
            expect(layout.classes()).toContain('is-cowork');

            await mode.setValue('chat');
            expect(layout.classes()).not.toContain('is-cowork');
            expect(chat.style.getPropertyValue('--integrated-chat-size')).toBe('42.00%');
        } finally {
            wrapper.unmount();
            if (previous === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, previous);
        }
    });

    it('loadHistory_履歴取得失敗時の再試行ボタンから復帰すること', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.windowMode = 'integrated';
        let historyAvailable = false;
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => ({
            ok: !String(url).startsWith('/api/mastra-history') || historyAvailable,
            json: async () => ({ enabled: true, sessions: [] })
        })));
        const wrapper = mount(IntegratedLayout);
        await vi.waitFor(() => expect(wrapper.find('.history-error').exists()).toBe(true));
        expect(wrapper.get('.history-error').attributes('role')).toBe('alert');
        historyAvailable = true;
        await wrapper.get('.history-error button').trigger('click');
        await vi.waitFor(() => expect(wrapper.find('.history-error').exists()).toBe(false));
        wrapper.unmount();
    });

    it('deleteMessage_削除エラーの閉じるボタンでは履歴を再読込しないこと', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.windowMode = 'integrated';
        const fetchMock = vi.fn().mockImplementation(async (_url, options) => ({
            ok: options?.method !== 'DELETE',
            json: async () => ({ enabled: true, selectionScope: 'test-scope', sessions: [
                { id: 'session', title: '会話', timestamp: 1000, messages: [{ id: 1000, sender: 'user', text: '質問' }] }
            ] })
        }));
        vi.stubGlobal('fetch', fetchMock);
        const wrapper = mount(IntegratedLayout);
        await vi.waitFor(() => expect(wrapper.findComponent(MessageList).props('messages')).toHaveLength(1));
        wrapper.findComponent(MessageList).vm.$emit('delete-message', 1000);
        await vi.waitFor(() => expect(wrapper.find('.history-error').exists()).toBe(true));
        expect(wrapper.get('.history-error button').text()).toBe('閉じる');
        const historyRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/mastra-history'));
        const count = historyRequests().length;
        await wrapper.get('.history-error button').trigger('click');
        expect(wrapper.find('.history-error').exists()).toBe(false);
        expect(historyRequests()).toHaveLength(count);
        expect(wrapper.findComponent(MessageList).props('messages')).toHaveLength(1);
        wrapper.unmount();
    });

    it('統合ウィンドウモードでマスコットをドラッグすると、ウィンドウは移動せずマスコットの比率位置が更新・保存されること', async () => {
        const configStore = useConfigStore();
        configStore.windowMode = 'integrated';
        const saveSpy = vi.spyOn(configStore, 'saveConfig').mockResolvedValue(undefined as any);

        const wrapper = mount(IntegratedLayout);

        // MascotViewerがマウントされ、.mascot-character要素が存在することを確認
        const mascotChar = wrapper.find('.mascot-character');
        expect(mascotChar.exists()).toBe(true);

        // マスコット表示エリアのサイズをモック (1000 x 800)
        const mascotWrapperEl = wrapper.find('.mascot-wrapper').element;
        vi.spyOn(mascotWrapperEl, 'getBoundingClientRect').mockReturnValue({
            left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800, x: 0, y: 0,
            toJSON: () => ({})
        } as DOMRect);

        // 1. ドラッグ開始 (mousedown) -> ウィンドウ移動 IPC は呼ばれない
        await mascotChar.trigger('mousedown', {
            button: 0,
            screenX: 200,
            screenY: 200,
        });
        expect(window.electronAPI!.dragWindow).not.toHaveBeenCalled();

        // 2. ドラッグ移動 (mousemove) -> 比率位置が移動量に応じて更新される
        window.dispatchEvent(new MouseEvent('mousemove', {
            screenX: 230,
            screenY: 215,
            buttons: 1,
        }));

        // X: 0.5 + 30/1000 = 0.53, Y: 0.5 + 15/800 = 0.51875
        expect(configStore.integratedMascotXRatio).toBeCloseTo(0.53);
        expect(configStore.integratedMascotYRatio).toBeCloseTo(0.51875);
        expect(window.electronAPI!.dragWindow).not.toHaveBeenCalled();

        // 3. ドラッグ終了 (mouseup) -> 設定が保存され、チャットのトグルは発生しない
        window.dispatchEvent(new MouseEvent('mouseup'));
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(window.electronAPI!.dragWindow).not.toHaveBeenCalled();
        expect(window.electronAPI!.toggleChat).not.toHaveBeenCalled();
    });

    it('統合ウィンドウモードでマスコットをドラッグせずクリックした場合、位置は変わらずチャットのトグルが呼ばれること', async () => {
        const configStore = useConfigStore();
        configStore.windowMode = 'integrated';
        const saveSpy = vi.spyOn(configStore, 'saveConfig').mockResolvedValue(undefined as any);

        const wrapper = mount(IntegratedLayout);
        const mascotChar = wrapper.find('.mascot-character');

        await mascotChar.trigger('mousedown', {
            button: 0,
            screenX: 200,
            screenY: 200,
        });
        window.dispatchEvent(new MouseEvent('mouseup'));

        expect(configStore.integratedMascotXRatio).toBeCloseTo(0.5);
        expect(configStore.integratedMascotYRatio).toBeCloseTo(0.5);
        expect(saveSpy).not.toHaveBeenCalled();
        expect(window.electronAPI!.toggleChat).toHaveBeenCalledTimes(1);
    });

    it('音楽ウィジェット表示中はチャット欄にプレイヤー分の高さを確保すること', async () => {
        const configStore = useConfigStore();
        const musicStore = useMusicStore();
        configStore.windowMode = 'integrated';
        musicStore.isLoaded = true;
        musicStore.showMusicWidget = true;

        const wrapper = mount(IntegratedLayout);
        const chatSection = wrapper.get('.chat-section');

        expect(chatSection.classes()).toContain('has-music-widget');
        expect(chatSection.classes()).not.toContain('has-expanded-music-widget');

        musicStore.playlistExpanded = true;
        await wrapper.vm.$nextTick();
        expect(chatSection.classes()).toContain('has-expanded-music-widget');

        musicStore.playlistExpanded = false;
        musicStore.contentPanelExpanded = true;
        await wrapper.vm.$nextTick();
        expect(chatSection.classes()).toContain('has-expanded-music-widget');
    });

    it('マスコット表示をOFFにしても表示エリアとスプリッターの幅を維持すること', async () => {
        const configStore = useConfigStore();
        configStore.windowMode = 'integrated';
        const wrapper = mount(IntegratedLayout);

        configStore.mascotVisible = false;
        await wrapper.vm.$nextTick();

        expect(wrapper.get('.integrated-container').classes()).toContain('is-mascot-hidden');
        expect(wrapper.find('.mascot-section').exists()).toBe(true);
        expect(wrapper.find('.section-splitter').exists()).toBe(true);
        expect(wrapper.find('.chat-section').exists()).toBe(true);
        expect(wrapper.findComponent(MascotViewer).exists()).toBe(true);
        expect(wrapper.get('.mascot-wrapper').attributes('style')).toContain('display: none');

        configStore.mascotVisible = true;
        await wrapper.vm.$nextTick();

        expect(wrapper.get('.integrated-container').classes()).not.toContain('is-mascot-hidden');
        expect(wrapper.get('.mascot-wrapper').attributes('style') || '').not.toContain('display: none');
    });

    describe('チャット欄の幅調整スプリッター', () => {
        const mountWithContainerRect = async () => {
            const configStore = useConfigStore();
            configStore.windowMode = 'integrated';
            const saveSpy = vi.spyOn(configStore, 'saveConfig').mockResolvedValue(undefined as any);

            const wrapper = mount(IntegratedLayout);
            const container = wrapper.find('.integrated-container');
            vi.spyOn(container.element, 'getBoundingClientRect').mockReturnValue({
                left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800, x: 0, y: 0,
                toJSON: () => ({})
            } as DOMRect);

            return { configStore, saveSpy, wrapper };
        };

        it('スプリッターをドラッグするとチャット欄の幅比率が更新され、ドラッグ終了時に保存されること', async () => {
            const { configStore, saveSpy, wrapper } = await mountWithContainerRect();

            const splitter = wrapper.find('.section-splitter');
            expect(splitter.exists()).toBe(true);

            await splitter.trigger('pointerdown', { pointerId: 1 });
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 }));

            // ratio = (1000 - 500) / 1000 = 0.5
            expect(configStore.integratedChatRatio).toBeCloseTo(0.5);
            expect(saveSpy).not.toHaveBeenCalled();

            window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
            expect(saveSpy).toHaveBeenCalledTimes(1);
        });

        it('幅比率が 0.2 - 0.8 の範囲にクランプされること', async () => {
            const { configStore, wrapper } = await mountWithContainerRect();
            const splitter = wrapper.find('.section-splitter');

            await splitter.trigger('pointerdown', { pointerId: 1 });
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: 950 }));
            expect(configStore.integratedChatRatio).toBeCloseTo(0.2);

            window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50 }));
            expect(configStore.integratedChatRatio).toBeCloseTo(0.8);

            window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
        });

        it('コンパクトモードではスプリッターが表示されないこと', async () => {
            const configStore = useConfigStore();
            configStore.windowMode = 'compact';

            const wrapper = mount(IntegratedLayout);
            expect(wrapper.find('.section-splitter').exists()).toBe(false);
        });
    });
});
