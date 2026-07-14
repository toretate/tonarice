// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectOutfitPreviewExpression, useMascotSettings, uploadImportedImage } from '../composables/useMascotSettings';
import { createPinia, setActivePinia } from 'pinia';
import { useConfigStore } from '../../../store/config';

vi.mock('../../../skills/expression-alignment/auto-align-v2', () => ({
    autoAlignBatch: vi.fn(),
    CONFIDENCE_THRESHOLD: 0.5
}));
vi.mock('../../../skills/expression-alignment/expression-auto-align', () => ({
    isValidImageSource: vi.fn().mockReturnValue(true)
}));
vi.mock('../../../mascots/MascotImageSetBuilder', () => ({
    MascotImageSetBuilder: {
        CreateFromAssets: vi.fn().mockReturnValue({
            getFrontImage: vi.fn().mockReturnValue({ path: 'front.png' })
        })
    }
}));

describe('useMascotSettings', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        
        // window.electronAPI のモックを設定
        (window as any).electronAPI = {
            getMascotPrompts: vi.fn().mockResolvedValue({
                identity: 'テストの役割設定',
                soul: 'テストの性格',
                user: 'テストの関係性',
                agents: 'テストの行動規範',
                memory: 'テストの長期記憶'
            }),
            previewMascotState: vi.fn(),
            getAppConfig: vi.fn().mockResolvedValue({
                googleAiStudioApiKey: 'test-api-key'
            })
        };
    });

    it('initEditingMascot - マスコット設定の初期ロード時に指定されたアクティブマスコットが読み込まれること', () => {
        const configStore = useConfigStore();
        configStore.mascots = [
            {
                id: 'mascot_a',
                name: 'マスコットA',
                avatar: '🤖',
                profile: 'プロフィールA',
                currentOutfitId: 'outfit_a',
                aiConfig: {
                    chat: { engine: 'gemini', model: 'gemini-2.0-flash-exp', temperature: 0.7 },
                    voice: { engine: 'voicevox', speaker_id: 2, style: 'normal' }
                },
                assets: { outfits: [], expressions: [], poses: [] }
            }
        ];

        const props = {
            mascots: configStore.mascots,
            activeMascotId: 'mascot_a',
            geminiApiKey: 'test-api-key'
        };

        const emit = vi.fn();

        const { editingMascot, initEditingMascot } = useMascotSettings(props, emit);
        initEditingMascot();

        expect(editingMascot.value.id).toBe('mascot_a');
        expect(editingMascot.value.name).toBe('マスコットA');
    });

    it('setDefaultExpression - 指定した表情IDが通常表示の表情として保存され、プレビューと設定保存イベントが送信されること', () => {
        const configStore = useConfigStore();
        const mascotMock = {
            id: 'mascot_b',
            name: 'マスコットB',
            avatar: '🐱',
            profile: 'プロフィールB',
            currentOutfitId: 'outfit_b',
            aiConfig: {
                chat: { engine: 'gemini', model: 'gemini-2.0-flash-exp', temperature: 0.7 },
                voice: { engine: 'voicevox', speaker_id: 2, style: 'normal' }
            },
            assets: {
                outfits: [],
                expressions: [
                    { id: 'expr_normal', name: '通常', path: 'normal.png' },
                    { id: 'expr_joy', name: '喜び', path: 'joy.png' }
                ],
                poses: []
            }
        };
        configStore.mascots = [mascotMock];

        const props = {
            mascots: configStore.mascots,
            activeMascotId: 'mascot_b',
            geminiApiKey: 'test-api-key'
        };

        const emit = vi.fn();

        const { editingMascot, activePreviewExpression, initEditingMascot, setDefaultExpression } = useMascotSettings(props, emit);
        initEditingMascot();

        // 通常表示の表情を「喜び」に設定
        setDefaultExpression('expr_joy');

        expect(editingMascot.value.defaultExpressionId).toBe('expr_joy');
        expect(activePreviewExpression.value?.id).toBe('expr_joy');
        expect(window.electronAPI!.previewMascotState).toHaveBeenCalled();
        expect(emit).toHaveBeenCalledWith('save-settings');
    });

    it('selectOutfitPreviewExpression - 新しい衣装の同名スロットに画像がなければ表情なしへフォールバックすること', () => {
        const expressions = [
            { id: 'expr_normal', name: '通常', path: '' },
            { id: 'expr_joy', name: '喜び', path: '' }
        ];

        expect(selectOutfitPreviewExpression(expressions, 'expr_joy', '喜び')).toBeNull();
    });

    it('selectOutfitPreviewExpression - 新しい衣装に指定表情があればその画像を選ぶこと', () => {
        const expressions = [
            { id: 'expr_normal', name: '通常', path: '/normal.png' },
            { id: 'expr_joy', name: '喜び', path: '/joy.png' }
        ];

        expect(selectOutfitPreviewExpression(expressions, 'expr_joy', '喜び')?.path).toBe('/joy.png');
    });

    describe('uploadImportedImage', () => {
        it('正常系：Base64画像ソースが渡された際、適切なファイル名に解決され saveMascotImage が成功した時に相対パスを返すこと', async () => {
            const saveMascotImageMock = vi.fn().mockResolvedValue({
                success: true,
                path: '/mascots/users/test_user/mascot_a/outfits/outfit_test.png'
            });
            (window as any).electronAPI.saveMascotImage = saveMascotImageMock;

            const base64Data = 'data:image/png;base64,iVBORw0K...';
            const resolvedPath = await uploadImportedImage('mascot_a', 'outfits', 'outfit_test', base64Data);

            expect(saveMascotImageMock).toHaveBeenCalledWith(
                'mascot_a',
                'outfits/outfit_test.png',
                base64Data
            );
            expect(resolvedPath).toBe('/mascots/users/test_user/mascot_a/outfits/outfit_test.png');
        });

        it('正常系：SVG形式のBase64画像ソースが渡された際、.svg拡張子で解決され saveMascotImage が成功すること', async () => {
            const saveMascotImageMock = vi.fn().mockResolvedValue({
                success: true,
                path: '/mascots/users/test_user/mascot_a/outfits/outfit_test.svg'
            });
            (window as any).electronAPI.saveMascotImage = saveMascotImageMock;

            const base64Data = 'data:image/svg+xml;base64,PHN2Zz4...';
            const resolvedPath = await uploadImportedImage('mascot_a', 'outfits', 'outfit_test', base64Data);

            expect(saveMascotImageMock).toHaveBeenCalledWith(
                'mascot_a',
                'outfits/outfit_test.svg',
                base64Data
            );
            expect(resolvedPath).toBe('/mascots/users/test_user/mascot_a/outfits/outfit_test.svg');
        });

        it('正常系：Base64以外のパス（すでに相対パス等）が渡された際、そのままのパスを返すこと', async () => {
            const saveMascotImageMock = vi.fn();
            (window as any).electronAPI.saveMascotImage = saveMascotImageMock;

            const path = '/mascots/users/test_user/mascot_a/outfits/outfit_test.png';
            const resolvedPath = await uploadImportedImage('mascot_a', 'outfits', 'outfit_test', path);

            expect(saveMascotImageMock).not.toHaveBeenCalled();
            expect(resolvedPath).toBe(path);
        });

        it('異常系：saveMascotImage が失敗した際、例外をスローすること', async () => {
            const saveMascotImageMock = vi.fn().mockResolvedValue({
                success: false,
                error: 'アップロードエラー'
            });
            (window as any).electronAPI.saveMascotImage = saveMascotImageMock;

            const base64Data = 'data:image/png;base64,iVBORw0K...';
            await expect(
                uploadImportedImage('mascot_a', 'outfits', 'outfit_test', base64Data)
            ).rejects.toThrow('アップロードエラー');
        });
    });
});
