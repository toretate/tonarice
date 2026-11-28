// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useChatHistory } from '../useChatHistory';
import { useMascotStore } from '../../../store/mascot';
import { useConfigStore } from '../../../store/config';
import { nextTick } from 'vue';
import { useAuthStore } from '../../../store/auth';

describe('useChatHistory.ts のテスト', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();

        // activeMascot を設定
        const configStore = useConfigStore();
        configStore.mascots = [{ id: 'default', name: 'マスコット', profile: 'プロファイル' }];
        configStore.activeMascotId = 'default';

        global.fetch = vi.fn().mockResolvedValue(Response.json({ sessions: [] }));
    });

    it('loadHistory_Mastra履歴を表示し、削除が成功した場合だけ画面から除くこと', async () => {
        const request = vi.mocked(fetch)
            .mockResolvedValueOnce({ ok: true, json: async () => ({
                enabled: true,
                sessions: [{ id: 'memory-session', title: '記憶', timestamp: 1000, messages: [{ id: 1000, sender: 'user', text: '合言葉' }] }]
            }) } as Response)
            .mockResolvedValueOnce({ ok: false } as Response)
            .mockResolvedValueOnce({ ok: true } as Response)
            .mockResolvedValueOnce({ ok: true } as Response);
        const history = useChatHistory(vi.fn());
        await history.loadHistory();
        expect(history.messages.value[0].text).toBe('合言葉');
        await history.deleteMessage(1000);
        expect(history.messages.value).toHaveLength(1);
        expect(history.historyError.value).toContain('削除できませんでした');
        await history.deleteMessage(1000);
        expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({
            kind: 'message', sessionId: 'memory-session', messageId: 1000, mascotId: 'default'
        });
        expect(history.messages.value).toHaveLength(0);
        await history.deleteSession('memory-session', new Event('click'));
        expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({
            kind: 'thread', sessionId: 'memory-session', mascotId: 'default'
        });
        expect(history.sessions.value.some(session => session.id === 'memory-session')).toBe(false);
    });

    it('loadHistory_初回取得失敗後も画面内で再試行して送信可能になること', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, sessions: [] }) } as Response);
        const history = useChatHistory(vi.fn());
        await history.loadHistory();
        expect(history.isHistoryLoaded.value).toBe(false);
        expect(history.historyError.value).toContain('再試行');
        await history.loadHistory();
        expect(history.isHistoryLoaded.value).toBe(true);
        expect(history.historyError.value).toBe('');
        expect(history.sessions.value).toHaveLength(1);
    });

    it('loadHistory_選択中の会話IDを本文とは別に復元すること', async () => {
        vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ enabled: true, selectionScope: 'user-scope', sessions: [
            { id: 'new', title: '新しい会話', timestamp: 2000, messages: [] },
            { id: 'old', title: '前の会話', timestamp: 1000, messages: [] }
        ] }) } as Response);
        const first = useChatHistory(vi.fn());
        await first.loadHistory();
        first.selectSession('old');
        await nextTick();
        useAuthStore().user = { id: 'loaded-after-settings', email: '', sub: '', role: 'user' };
        const second = useChatHistory(vi.fn());
        await second.loadHistory();
        expect(second.activeSessionId.value).toBe('old');
    });

    it('loadHistory_マスコット切替中の古い通信結果を適用しないこと', async () => {
        const config = useConfigStore();
        config.mascots.push({ id: 'other', name: '別のマスコット' } as any);
        let resolveFirst!: (value: Response) => void;
        vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, sessions: [
                { id: 'other-session', title: '別の会話', timestamp: 1000, messages: [] }
            ] }) } as Response);
        const history = useChatHistory(vi.fn());
        const loading = history.loadHistory();
        config.activeMascotId = 'other';
        await vi.waitFor(() => expect(history.activeSessionId.value).toBe('other-session'));
        resolveFirst({ ok: false } as Response);
        await loading;
        expect(history.isHistoryLoaded.value).toBe(true);
        expect(history.historyError.value).toBe('');
        expect(history.activeSessionId.value).toBe('other-session');
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
});
