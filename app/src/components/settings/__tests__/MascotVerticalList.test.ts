// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import MascotVerticalList from '../components/MascotVerticalList.vue';

const createMascot = () => ({
    id: 'mascot-1',
    name: 'テストマスコット',
    avatar: '🤖',
    profile: '',
    currentOutfitId: 'outfit-1',
    aiConfig: {
        chat: { engine: '', model: '', temperature: 0.7 },
        voice: {}
    },
    assets: {
        outfits: [],
        expressions: [],
        poses: []
    }
});

describe('MascotVerticalList', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('切替先衣装の指定表情に画像がない場合は新しい衣装画像を表示すること', async () => {
        const mascot = createMascot();
        const wrapper = mount(MascotVerticalList, {
            props: {
                mascots: [mascot],
                activeMascotId: mascot.id,
                activePose: { id: 'pose-1', name: 'ポーズ', path: '/pose.png' },
                activeOutfit: { id: 'outfit-1', name: '衣装1', path: '/outfit-1.png' },
                defaultFrontAvatar: null,
                activePreviewExpression: { id: 'expr-joy', name: '喜び', path: '' },
                computedListPreviewExpressionStyle: {}
            },
            global: {
                stubs: { Button: true }
            }
        });

        expect(wrapper.get('[data-testid="active-outfit-preview"]').attributes('src')).toBe('/outfit-1.png');
        expect(wrapper.find('[data-testid="active-noface-preview"]').exists()).toBe(false);

        await wrapper.setProps({
            activeOutfit: { id: 'outfit-2', name: '衣装2', path: '/outfit-2.png' }
        });

        expect(wrapper.get('[data-testid="active-outfit-preview"]').attributes('src')).toBe('/outfit-2.png');
    });

    it('表情を切り替えてもnofaceの上に新しい表情を合成表示すること', async () => {
        const mascot = createMascot();
        const wrapper = mount(MascotVerticalList, {
            props: {
                mascots: [mascot],
                activeMascotId: mascot.id,
                activePose: null,
                activeOutfit: {
                    id: 'outfit-2',
                    name: '衣装2',
                    path: '/outfit-2.png',
                    nofacePath: '/mascots/users/test/mascot-1/outfits/outfit-2/noface.png'
                },
                defaultFrontAvatar: null,
                activePreviewExpression: { id: 'expr-normal', name: '通常', path: '/outfit-2-normal.png' },
                computedListPreviewExpressionStyle: {}
            },
            global: {
                stubs: { Button: true }
            }
        });

        const loadImage = async (testId: string, width: number, height: number) => {
            const image = wrapper.get(`[data-testid="${testId}"]`);
            Object.defineProperty(image.element, 'naturalWidth', { configurable: true, value: width });
            Object.defineProperty(image.element, 'naturalHeight', { configurable: true, value: height });
            await image.trigger('load');
        };

        await loadImage('active-outfit-size-probe', 1536, 1920);
        await loadImage('active-noface-preview', 922, 1152);
        await loadImage('active-expression-preview', 227, 189);

        expect(wrapper.get('[data-testid="active-noface-preview"]').attributes('src')).toContain('/outfits/outfit-2/noface.png');
        expect(wrapper.get('[data-testid="active-expression-preview"]').attributes('style')).not.toContain('display: none');

        await wrapper.setProps({
            activePreviewExpression: { id: 'expr-joy', name: '喜び', path: '/outfit-2-joy.png' }
        });
        await loadImage('active-expression-preview', 231, 193);

        expect(wrapper.get('[data-testid="active-noface-preview"]').attributes('src')).toContain('/outfits/outfit-2/noface.png');
        expect(wrapper.get('[data-testid="active-expression-preview"]').attributes('src')).toBe('/outfit-2-joy.png');
        expect(wrapper.get('[data-testid="active-expression-preview"]').attributes('style')).not.toContain('display: none');

        await wrapper.setProps({
            activeOutfit: {
                id: 'outfit-3',
                name: '衣装3',
                path: '/outfit-3.png',
                nofacePath: '/mascots/users/test/mascot-1/outfits/outfit-3/noface.png'
            },
            activePreviewExpression: { id: 'expr-joy-3', name: '喜び', path: '/outfit-3-joy.png' }
        });

        expect(wrapper.get('[data-testid="active-noface-preview"]').attributes('src')).toContain('/outfits/outfit-3/noface.png');
        expect(wrapper.get('[data-testid="active-expression-preview"]').attributes('src')).toBe('/outfit-3-joy.png');
    });
});
