import { expect, test, vi } from 'vitest';
import { resolveChatPrompt } from '../chat-prompt';
import { readUserMascotPrompts } from '../../utils/mascot-prompts';
import { isAuthBypassAllowed } from '../../utils/auth-bypass';

vi.mock('../../utils/mascot-prompts', () => ({ readUserMascotPrompts: vi.fn() }));
vi.mock('../../utils/auth-bypass', () => ({ isAuthBypassAllowed: vi.fn() }));

test('resolveChatPrompt_旧形式とCLI明示指定に指示を追加しない', () => {
    expect(resolveChatPrompt('owner', { systemPrompt: '指定文' }).systemPrompt).toBe('指定文');
    expect(resolveChatPrompt('owner', {
        promptVersion: 1, chatMode: 'cli_override', systemPrompt: '指定文'
    }).systemPrompt).toBe('指定文');
});

test('resolveChatPrompt_未ログインと未同期マスコットはローカルプロフィールを利用して保存しない', () => {
    for (const userId of ['anonymous', 'owner']) {
        const result = resolveChatPrompt(userId, {
            promptVersion: 1, chatMode: 'normal', activeMascotId: 'unsynced', localProfile: '未同期プロフィール'
        });
        expect(result.canPersist).toBe(false);
        expect(result.systemPrompt).toContain('未同期プロフィール');
    }
});

test('resolveChatPrompt_所有マスコットの記憶を読み込み開発用の旧参照を限定する', () => {
    vi.mocked(isAuthBypassAllowed).mockReturnValue(true);
    vi.mocked(readUserMascotPrompts).mockReturnValue({
        configured: true, revision: 'test', prompts: { identity: '', soul: '', user: '', agents: '', memory: '保存済み記憶' }
    });
    const input = { promptVersion: 1, chatMode: 'normal', activeMascotId: 'owned', systemPrompt: '旧プロンプト' };
    const result = resolveChatPrompt('owner', input);
    expect(result.canPersist).toBe(true);
    expect(result.systemPrompt).toContain('保存済み記憶');
    expect(result.systemPrompt).not.toContain('旧プロンプト');
    expect(readUserMascotPrompts).toHaveBeenLastCalledWith('owner', 'owned', { allowLegacyLocalFallback: false });
    resolveChatPrompt('usr_local_dev_bypass', input);
    expect(readUserMascotPrompts).toHaveBeenLastCalledWith('usr_local_dev_bypass', 'owned', { allowLegacyLocalFallback: true });
    vi.mocked(readUserMascotPrompts).mockReset();
});

test('resolveChatPrompt_ラジオの発話モードとIrodori設定を適用する', () => {
    const base = { promptVersion: 1, engine: 'lmstudio', selectedVoiceEngine: 'irodori' };
    const radio = resolveChatPrompt('anonymous', { ...base, chatMode: 'radio' });
    const talk = resolveChatPrompt('anonymous', { ...base, chatMode: 'active_talk' });
    const extended = resolveChatPrompt('anonymous', { ...base, chatMode: 'radio', extendedRadio: true });
    const voice = resolveChatPrompt('anonymous', { ...base, chatMode: 'radio', useTts: true });
    expect(talk.systemPrompt.length).toBeGreaterThan(radio.systemPrompt.length);
    expect(talk.canPersist).toBe(false);
    expect(extended.systemPrompt).not.toBe(radio.systemPrompt);
    expect(radio.systemPrompt).not.toContain('Irodori-TTS Speech Tags');
    expect(voice.systemPrompt).toContain('Irodori-TTS Speech Tags');
});
