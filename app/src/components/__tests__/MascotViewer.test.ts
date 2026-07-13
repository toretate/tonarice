// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import MascotViewer from '../MascotViewer.vue';
import { useConfigStore } from '../../store/config';

const { mockAssetsLoad, mockAssetsBackgroundLoad, mockAssetsUnload, mockSprites } = vi.hoisted(() => ({
    mockAssetsLoad: vi.fn(),
    mockAssetsBackgroundLoad: vi.fn(),
    mockAssetsUnload: vi.fn(),
    mockSprites: [] as any[]
}));

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
            constructor() { mockSprites.push(this); }
            texture = {};
            anchor = { set: () => {} };
            scale = {
                x: 1,
                y: 1,
                set: function(value: number) { this.x = value; this.y = value; }
            };
            rotation = 0;
            visible = true;
        },
        Assets: {
            load: mockAssetsLoad,
            backgroundLoad: mockAssetsBackgroundLoad,
            unload: mockAssetsUnload
        },
        Texture: {
            EMPTY: {}
        }
    };
});

describe('MascotViewer.vue - ドラッグ＆ドロップテスト', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mockAssetsLoad.mockReset().mockResolvedValue({ width: 100, height: 100 });
        mockAssetsBackgroundLoad.mockReset().mockResolvedValue(undefined);
        mockAssetsUnload.mockReset().mockResolvedValue(undefined);
        mockSprites.length = 0;
        
        // window.electronAPI のモック
        window.electronAPI = {
            dragWindow: vi.fn(),
            setIgnoreMouseEvents: vi.fn(),
            toggleChat: vi.fn(),
            onTimerTrigger: vi.fn().mockReturnValue(() => {}),
            getAppConfig: vi.fn().mockResolvedValue({ mascotScale: 1.0, windowMode: 'split' }),
            onApplyPreviewState: vi.fn().mockReturnValue(() => {}),
            onChatToggled: vi.fn().mockReturnValue(() => {}),
            onEmotionChanged: vi.fn().mockReturnValue(() => {}),
            onConfigUpdated: vi.fn().mockReturnValue(() => {}),
        } as any;
    });

    it('マスコットキャラクター上でmousedownしてドラッグしたとき、dragWindow IPCイベントが呼ばれること', async () => {
        const wrapper = mount(MascotViewer);

        const mascotChar = wrapper.find('.mascot-character');
        expect(mascotChar.exists()).toBe(true);

        // 1. ドラッグ開始 (mousedown)
        await mascotChar.trigger('mousedown', {
            button: 0,
            screenX: 100,
            screenY: 100,
        });

        expect(window.electronAPI!.dragWindow).toHaveBeenNthCalledWith(1, {
            dx: 0,
            dy: 0,
            isStart: true
        });

        // 2. ドラッグ移動 (mousemove)
        const moveEvent = new MouseEvent('mousemove', {
            screenX: 120,
            screenY: 130,
            buttons: 1, // ドラッグ中であることを示すために必要
        });
        window.dispatchEvent(moveEvent);

        // dragWindow が正しい差分 { dx: 20, dy: 30 } で呼ばれたことを確認
        expect(window.electronAPI!.dragWindow).toHaveBeenNthCalledWith(2, {
            dx: 20,
            dy: 30
        });

        // 3. ドラッグ終了 (mouseup)
        const upEvent = new MouseEvent('mouseup');
        window.dispatchEvent(upEvent);

        expect(window.electronAPI!.dragWindow).toHaveBeenNthCalledWith(3, {
            dx: 0,
            dy: 0,
            isEnd: true
        });

        wrapper.unmount();
    });

    it('画像パスの版数だけが変わった場合も新しいURLをロードすること', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.mascots = [{
            id: 'mascot-1',
            name: 'テストマスコット',
            avatar: '🤖',
            profile: '',
            currentOutfitId: 'outfit-1',
            assets: {
                outfits: [{
                    id: 'outfit-1',
                    name: '通常衣装',
                    path: '/mascots/users/user-1/mascot-1/outfits/body.png?v=version-1',
                    expressions: []
                }],
                expressions: [],
                poses: []
            },
            aiConfig: { chat: { engine: '', model: '', temperature: 0.7 }, voice: {} }
        }] as any;
        configStore.activeMascotId = 'mascot-1';

        const wrapper = mount(MascotViewer);
        await new Promise(resolve => setTimeout(resolve, 120));

        expect(mockAssetsLoad).toHaveBeenCalledWith(expect.stringContaining('body.png?v=version-1'));

        configStore.mascots[0].assets.outfits[0].path =
            '/mascots/users/user-1/mascot-1/outfits/body.png?v=version-2';
        await nextTick();
        await new Promise(resolve => setTimeout(resolve, 120));

        expect(mockAssetsLoad).toHaveBeenCalledWith(expect.stringContaining('body.png?v=version-2'));
        wrapper.unmount();
    });

    it('currentBodyPath_衣装に表情とnofaceがある場合は衣装固有nofaceを表示すること', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.mascots = [{
            id: 'mascot-1',
            name: 'テストマスコット',
            avatar: '🤖',
            profile: '',
            currentOutfitId: 'outfit-1',
            defaultExpressionId: 'expr-normal',
            assets: {
                outfits: [{
                    id: 'outfit-1',
                    name: '通常衣装',
                    path: '/mascots/body.png',
                    nofacePath: '/mascots/outfits/outfit-1/noface.png',
                    expressions: [{ id: 'expr-normal', name: '通常', path: '/mascots/parts-normal.png' }]
                }],
                expressions: [],
                poses: []
            },
            aiConfig: { chat: { engine: '', model: '', temperature: 0.7 }, voice: {} }
        }] as any;
        configStore.activeMascotId = 'mascot-1';

        const wrapper = mount(MascotViewer);
        await new Promise(resolve => setTimeout(resolve, 120));

        expect(mockAssetsLoad).toHaveBeenCalledWith(expect.stringContaining('/outfits/outfit-1/noface.png'));
        expect(mockAssetsLoad).toHaveBeenCalledWith(expect.stringContaining('/parts-normal.png'));
        wrapper.unmount();
    });

    it('applyExpressionTransform_元衣装ピクセルの位置をnoface表示倍率で変換すること', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.mascots = [{
            id: 'mascot-1', name: 'テストマスコット', avatar: '🤖', profile: '',
            currentOutfitId: 'outfit-1', defaultExpressionId: 'expr-normal',
            assets: {
                outfits: [{
                    id: 'outfit-1', name: '通常衣装', path: '/mascots/body.png',
                    nofacePath: '/mascots/outfits/outfit-1/noface.png',
                    expressions: [{
                        id: 'expr-normal', name: '通常', path: '/mascots/parts-normal.png',
                        offsetX: 18, offsetY: -514, scale: 1.16
                    }]
                }],
                expressions: [], poses: []
            },
            aiConfig: { chat: { engine: '', model: '', temperature: 0.7 }, voice: {} }
        }] as any;
        configStore.activeMascotId = 'mascot-1';
        mockAssetsLoad.mockImplementation((url: string) => Promise.resolve(
            url.includes('noface.png')
                ? { width: 1536, height: 1920 }
                : { width: 227, height: 189 }
        ));

        const wrapper = mount(MascotViewer);
        await new Promise(resolve => setTimeout(resolve, 120));

        const expressionSprite = mockSprites[1];
        const bodyScale = 640 / 1920;
        expect(expressionSprite.x).toBeCloseTo(256 + 18 * bodyScale, 4);
        expect(expressionSprite.y).toBeCloseTo(341.5 - 514 * bodyScale, 4);
        expect(expressionSprite.scale.x).toBeCloseTo(bodyScale * 1.16, 4);
        wrapper.unmount();
    });

    it('古い画像ロードが遅れて完了しても新しいテクスチャを上書きしないこと', async () => {
        const configStore = useConfigStore();
        configStore.isLoaded = true;
        configStore.mascots = [{
            id: 'mascot-1', name: 'テストマスコット', avatar: '🤖', profile: '',
            currentOutfitId: 'outfit-1',
            assets: {
                outfits: [{ id: 'outfit-1', name: '通常衣装', path: '/mascots/body.png?v=old', expressions: [] }],
                expressions: [], poses: []
            },
            aiConfig: { chat: { engine: '', model: '', temperature: 0.7 }, voice: {} }
        }] as any;
        configStore.activeMascotId = 'mascot-1';

        let finishOldLoad!: (texture: any) => void;
        const oldTexture = { width: 100, height: 100, id: 'old' };
        const newTexture = { width: 100, height: 100, id: 'new' };
        mockAssetsLoad.mockImplementation((url: string) => {
            if (url.includes('v=old')) {
                return new Promise(resolve => { finishOldLoad = resolve; });
            }
            return Promise.resolve(newTexture);
        });

        const wrapper = mount(MascotViewer);
        await new Promise(resolve => setTimeout(resolve, 100));
        configStore.mascots[0].assets.outfits[0].path = '/mascots/body.png?v=new';
        await nextTick();
        await new Promise(resolve => setTimeout(resolve, 120));

        expect(mockSprites[0].texture).toBe(newTexture);
        expect(mockSprites[0].visible).toBe(true);
        finishOldLoad(oldTexture);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockSprites[0].texture).toBe(newTexture);
        expect(mockAssetsUnload).toHaveBeenCalledWith(expect.stringContaining('body.png?v=old'));
        wrapper.unmount();
    });
});
