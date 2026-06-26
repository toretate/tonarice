// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useChatHistory } from '../useChatHistory';
import { useMascotStore } from '../../../store/mascot';
import { useConfigStore } from '../../../store/config';
import { nextTick } from 'vue';

describe('useChatHistory.ts のテスト', () => {
    beforeEach(() => {
        setActivePinia(createPinia());

        // activeMascot を設定
        const configStore = useConfigStore();
        configStore.mascots = [{ id: 'default', name: 'マスコット', profile: 'プロファイル' }];
        configStore.activeMascotId = 'default';

        // window.electronAPI のモック
        window.electronAPI = {
            getChatHistory: vi.fn().mockResolvedValue({}),
            saveChatHistory: vi.fn().mockResolvedValue(undefined),
            getMascotPrompts: vi.fn().mockResolvedValue({ memory: '既存の長期記憶' }),
            saveMascotPrompts: vi.fn().mockResolvedValue(undefined)
        } as any;

        // グローバルの fetch をモック
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, summary: '要約テキスト', memory: '新しい長期記憶' })
        }) as any;
    });

    it('applyActiveMascotHistory_通常モード時は通常セッションをロードし、シークレットモード時はシークレットセッションをロードすること', async () => {
        const scrollToBottom = vi.fn();
        const history = useChatHistory(scrollToBottom);
        const mascotStore = useMascotStore();

        // 履歴ロード
        await history.loadHistory();

        // 初期セッション数は通常モード時 1つ
        expect(history.sessions.value.length).toBe(1);
        expect(history.sessions.value[0].isSecret).toBeFalsy();

        // シークレットモードをONにする
        mascotStore.setSecretMode(true);
        await nextTick();

        // セッションがシークレットのものに切り替わる
        expect(history.sessions.value.length).toBe(1);
        expect(history.sessions.value[0].isSecret).toBe(true);
        expect(history.sessions.value[0].title).toBe('シークレットの話題');

        // シークレットモードをOFFに戻す
        mascotStore.setSecretMode(false);
        await nextTick();

        // 通常セッションに戻る
        expect(history.sessions.value[0].isSecret).toBeFalsy();
    });

    it('runCompaction_シークレットセッションの場合は長期記憶の更新処理がスキップされること', async () => {
        const scrollToBottom = vi.fn();
        const history = useChatHistory(scrollToBottom);
        const mascotStore = useMascotStore();

        await history.loadHistory();

        // シークレットモードでセッションを作成
        mascotStore.setSecretMode(true);
        await nextTick();

        // セッション内のメッセージ数を要約閾値(15)以上にするためメッセージを追加
        const currentSession = history.sessions.value[0];
        currentSession.messages = Array.from({ length: 15 }, (_, i) => ({
            id: i,
            sender: i % 2 === 0 ? 'user' : 'mascot',
            text: `メッセージ ${i}`
        }));

        // runCompaction の実行
        await history.runCompaction('default', currentSession.id);

        // シークレットセッションであるため、saveMascotPrompts は呼び出されていないはず
        expect(window.electronAPI!.saveMascotPrompts).not.toHaveBeenCalled();

        // 通常モードに戻す
        mascotStore.setSecretMode(false);
        await nextTick();

        const normalSession = history.sessions.value[0];
        normalSession.messages = Array.from({ length: 15 }, (_, i) => ({
            id: i,
            sender: i % 2 === 0 ? 'user' : 'mascot',
            text: `メッセージ ${i}`
        }));

        // 通常セッションで runCompaction を実行
        await history.runCompaction('default', normalSession.id);

        // 通常セッションなので saveMascotPrompts が呼び出されていること
        expect(window.electronAPI!.saveMascotPrompts).toHaveBeenCalled();
    });
});
