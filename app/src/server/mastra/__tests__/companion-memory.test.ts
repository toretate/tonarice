import { afterAll, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText } from 'ai';
import { createMemoryStore } from '../memory-store';
import { appendMemoryTurn, deleteMemoryMessage, memoryMessageId } from '../memory-history';
import { getChatDatabasePath, withChatDatabase } from '../chat-sequence';
import { learningMetadata, learningStatus, refreshCompanionSources, runLearningOnce } from '../learning-jobs';
import { editCompanionState, finishCompanionNudge, getCompanionState, readCompanionSnapshot, reserveCompanionContext, updateCompanionMemory } from '../companion-memory';
import { writeUserMascotMemory, writeUserMascotPrompts } from '../../utils/mascot-prompts';
import { broadcastToUser } from '../../utils/user-connections';
import { canOfferCompanionNudge } from '../companion-context';

const fixture = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../utils/paths', async importOriginal => ({
    ...(await importOriginal<typeof import('../../utils/paths')>()),
    get USERS_DIR() { return join(fixture.dir, 'users'); }
}));
vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof import('ai')>()), generateText: vi.fn() }));
vi.mock('../../utils/user-connections', () => ({ broadcastToUser: vi.fn() }));
fixture.dir = mkdtempSync(join(tmpdir(), 'tonarice-companion-'));
afterAll(() => { try { rmSync(fixture.dir, { recursive: true, force: true }); } catch { /* OS の一時領域に残す。 */ } });

function setup(mascotId: string, userId = 'owner') {
    const scope = { userId, mascotId, sessionId: 'session', isSecret: false };
    const dir = join(fixture.dir, 'users', scope.userId, 'mascots', mascotId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mascot_config.json'), '{}');
    return { dir, scope };
}

test('runLearningOnce_本人発言を出所別に一括抽出し削除された出典に由来する項目と版を除く', async () => {
    const { dir, scope } = setup('learn');
    const directory = join(fixture.dir, 'learn-db');
    const endpoint = 'http://127.0.0.1:15479/v1';
    writeFileSync(join(fixture.dir, 'users', scope.userId, 'user_config.json'), JSON.stringify({ lmstudioEndpoint: endpoint }));
    const now = Date.now() - 3600000;
    let store = createMemoryStore(directory);
    try {
        const selection = learningMetadata(scope.userId, scope.mascotId, 'lmstudio', 'test-model', endpoint, true, now);
        await appendMemoryTurn(store.memory, scope, { userId: 101, assistantId: 102, message: '旧履歴', reply: '旧応答' });
        await appendMemoryTurn(store.memory, scope, {
            userId: 103, assistantId: 104, message: '外部検索の発言', reply: '外部検索の応答', learning: { ...selection, eligible: false }
        });
        await appendMemoryTurn(store.memory, scope, {
            userId: 105, assistantId: 106, message: '毎週の締切を気にしています', reply: 'AIの応答', learning: selection
        });
        await appendMemoryTurn(store.memory, scope, {
            userId: 107, assistantId: 108, message: '別件の相談も覚えてください', reply: 'AIの応答', learning: selection
        });
        await store.storage.close();
        store = createMemoryStore(directory);
        const filename = (await getChatDatabasePath(store.memory))!;
        const extracted = [
            { kind: 'user', key: '締切', text: '週次の締切を気にする', sourceIndexes: [1] },
            { kind: 'memory', key: '別件の相談', text: '別件について相談する', sourceIndexes: [2] },
            { kind: 'concern', key: '今週の締切', text: '今週の締切', sourceIndexes: [1] },
            { kind: 'condition', key: '近況', text: '締切と別件が気になっている', sourceIndexes: [1, 2] }
        ];
        vi.mocked(generateText).mockResolvedValueOnce({ text: JSON.stringify(extracted) } as Awaited<ReturnType<typeof generateText>>);
        await runLearningOnce(filename, new AbortController().signal);
        await runLearningOnce(filename, new AbortController().signal);
        expect(generateText).toHaveBeenCalledOnce();
        expect(broadcastToUser).toHaveBeenCalledOnce();
        expect(vi.mocked(generateText).mock.calls.at(-1)?.[0]).toMatchObject({
            model: { modelId: 'test-model' }, maxRetries: 0, prompt: JSON.stringify({ userEvidence: [
                { index: 1, text: '毎週の締切を気にしています' }, { index: 2, text: '別件の相談も覚えてください' }
            ] })
        });
        expect(getCompanionState(scope.userId, scope.mascotId)).toMatchObject({ enabled: true, concerns: [{ text: '今週の締切' }] });
        expect(readFileSync(join(dir, 'user.md'), 'utf8')).toContain('週次の締切');
        const reserved = reserveCompanionContext(scope.userId, scope.mascotId, true);
        expect(reserved?.concern).toBe('今週の締切');
        expect(reserveCompanionContext(scope.userId, scope.mascotId, true)?.concern).toBeUndefined();
        finishCompanionNudge(scope.userId, scope.mascotId, reserved!.token!, false);
        const retried = reserveCompanionContext(scope.userId, scope.mascotId, true)!;
        expect(retried.concern).toBe('今週の締切');
        finishCompanionNudge(scope.userId, scope.mascotId, retried.token!, true);
        expect(reserveCompanionContext(scope.userId, scope.mascotId, true)?.concern).toBeUndefined();
        const revision = getCompanionState(scope.userId, scope.mascotId)!.revision!.id;
        await deleteMemoryMessage(store.memory, scope, memoryMessageId(scope, 105));
        refreshCompanionSources(filename, scope.userId, scope.mascotId);
        expect(readFileSync(join(dir, 'user.md'), 'utf8')).not.toContain('週次の締切');
        expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toContain('別件について相談する');
        expect(getCompanionState(scope.userId, scope.mascotId)?.concerns).toEqual([]);
        expect(editCompanionState(scope.userId, scope.mascotId, { undoId: revision })).toBe('gone');
        expect(reserveCompanionContext(scope.userId, scope.mascotId, false)?.condition).toBeUndefined();
    } finally { await store.storage.close(); }
});

test('updateCompanionMemory_手動編集との競合を拒否し差分Undoで後続編集を保護する', () => {
    const { dir, scope } = setup('undo');
    const owner = scope.userId;
    const mascot = scope.mascotId;
    const source = { id: 'evidence', seq: 1, observedAt: Date.now() };
    const proposal = [{ kind: 'memory', key: '相談', text: '相談事項を覚える' }] as const;
    const snapshot = readCompanionSnapshot(owner, mascot)!;
    writeUserMascotMemory(owner, mascot, '手動の記録');
    expect(updateCompanionMemory(owner, mascot, snapshot.version, source, [...proposal], () => true)).toBe('conflict');
    const fresh = readCompanionSnapshot(owner, mascot)!;
    expect(updateCompanionMemory(owner, mascot, fresh.version, source, [...proposal], () => true)).toBe('updated');
    const revision = getCompanionState(owner, mascot)!.revision!.id;
    const current = readFileSync(join(dir, 'memory.md'), 'utf8');
    writeUserMascotMemory(owner, mascot, current + '\n後から手動追記');
    expect(editCompanionState(owner, mascot, { undoId: revision })).toBe('done');
    expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toBe('手動の記録\n後から手動追記');
    expect(getCompanionState('other-owner', mascot)).toBeUndefined();
});

test('runLearningOnce_サーバーに利用可能なキーがなければ通信せず保留する', async () => {
    const { scope } = setup('pending');
    const store = createMemoryStore(join(fixture.dir, 'pending-db'));
    try {
        await appendMemoryTurn(store.memory, scope, {
            userId: 201, assistantId: 202, message: '保存済み発言', reply: '返答',
            learning: learningMetadata(scope.userId, scope.mascotId, 'openai', 'test-model', undefined, true, Date.now() - 3600000)
        });
        const filename = (await getChatDatabasePath(store.memory))!;
        vi.mocked(generateText).mockClear();
        await runLearningOnce(filename, new AbortController().signal);
        expect(generateText).not.toHaveBeenCalled();
        expect(learningStatus(filename, scope.userId, scope.mascotId)).toEqual(['pending_credentials']);
    } finally { await store.storage.close(); }
});

test('readCompanionSnapshot_途中終了した更新を復旧し自動更新OFFでは確定しない', () => {
    const { dir, scope } = setup('recover');
    writeFileSync(join(dir, '.mascot-memory-journal.json'), JSON.stringify({
        'user.md': '先に確定したユーザー情報',
        'memory.md': '先に確定した記憶',
        'pulse.json': JSON.stringify({ enabled: false, items: [], deleted: {}, revisions: [] })
    }));
    const snapshot = readCompanionSnapshot(scope.userId, scope.mascotId)!;
    expect(snapshot.enabled).toBe(false);
    expect(readFileSync(join(dir, 'user.md'), 'utf8')).toBe('先に確定したユーザー情報');
    expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toBe('先に確定した記憶');
    expect(updateCompanionMemory(scope.userId, scope.mascotId, snapshot.version,
        { id: 'source', seq: 2, observedAt: Date.now() }, [
            { kind: 'user', key: '設定', text: '自動で追記される情報' }
        ], () => true)).toBe('gone');
});

test('updateCompanionMemory_マスコットの共有状態が変わった場合に古い抽出結果を確定しない', () => {
    const { dir, scope } = setup('different-files');
    const source = { id: 'evidence', seq: 1, observedAt: Date.now() };
    for (const filename of ['user.md', 'memory.md', 'pulse.json']) {
        const snapshot = readCompanionSnapshot(scope.userId, scope.mascotId)!;
        writeFileSync(join(dir, filename), filename === 'pulse.json'
            ? JSON.stringify({ enabled: true, items: [], deleted: {}, revisions: [] }) : '編集済み');
        expect(updateCompanionMemory(scope.userId, scope.mascotId, snapshot.version, source, [
            { kind: 'memory', key: '相談', text: '相談事項' }
        ], () => true)).toBe('conflict');
    }
});

test.each([
    { name: '設定ファイルなし', config: undefined, endpoint: 'http://127.0.0.1:1234/v1/', allowed: true },
    { name: '接続先なし', config: {}, endpoint: 'http://localhost:1234/v1', allowed: true },
    { name: '空の接続先', config: { lmstudioEndpoint: ' ' }, endpoint: 'http://127.0.0.1:1234/v1', allowed: true },
    { name: '既定以外の接続先は設定が必要', config: undefined, endpoint: 'http://127.0.0.1:2345/v1', allowed: false },
    { name: '明示された接続先は正規化して照合', config: { lmstudioEndpoint: 'http://LOCALHOST:2345/v1/' }, endpoint: 'http://localhost:2345/v1', allowed: true },
    { name: '明示された接続先と不一致', config: { lmstudioEndpoint: 'http://localhost:2345/v1' }, endpoint: 'http://localhost:1234/v1', allowed: false }
])('runLearningOnce_LM Studio の $name を判定する', async ({ config, endpoint, allowed, name }) => {
    const owner = 'lm-' + Buffer.from(name).toString('hex').slice(-20);
    const { scope } = setup('mascot', owner);
    if (config) writeFileSync(join(fixture.dir, 'users', owner, 'user_config.json'), JSON.stringify(config));
    const store = createMemoryStore(join(fixture.dir, owner));
    try {
        await appendMemoryTurn(store.memory, scope, {
            userId: 301, assistantId: 302, message: '確認する情報', reply: '返答',
            learning: learningMetadata(owner, scope.mascotId, 'lmstudio', 'test-model', endpoint, true, Date.now() - 3600000)
        });
        const filename = (await getChatDatabasePath(store.memory))!;
        vi.mocked(generateText).mockReset().mockResolvedValue({ text: '[]' } as Awaited<ReturnType<typeof generateText>>);
        await runLearningOnce(filename, new AbortController().signal);
        expect(generateText).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(learningStatus(filename, owner, scope.mascotId)).toEqual(allowed ? [] : ['pending_credentials']);
    } finally { await store.storage.close(); }
});

test.each(['user', 'memory'] as const)('updateCompanionMemory_%s の手動削除を反映し新しい発言から再抽出できる', kind => {
    const { dir, scope: { userId, mascotId } } = setup('remove-' + kind);
    const apply = (seq: number, text: string) => updateCompanionMemory(userId, mascotId, readCompanionSnapshot(userId, mascotId)!.version,
        { id: 'source-' + seq, seq, observedAt: Date.now() }, [{ kind, key: '相談', text }], () => true);
    expect(apply(1, '削除する自動記憶')).toBe('updated');
    const previous = getCompanionState(userId, mascotId)!.revision!.id;
    if (kind === 'user') writeUserMascotPrompts(userId, mascotId, { user: '手動記録' });
    else writeUserMascotMemory(userId, mascotId, '手動記録');
    expect(editCompanionState(userId, mascotId, { undoId: previous })).toBe('gone');
    expect(apply(1, '古い発言からの再抽出')).toBe('done');
    expect(apply(2, '新しい発言からの記憶')).toBe('updated');
    const markdown = readFileSync(join(dir, kind + '.md'), 'utf8');
    expect(markdown).toContain('手動記録');
    expect(markdown).toContain('新しい発言からの記憶');
    expect(markdown).not.toContain('削除する自動記憶');
});

test.each(['不正JSON', '生成エラー'] as const)('runLearningOnce_%s の3回目で抽出を終了する', async (cause) => {
    const { scope } = setup('failure-limit', 'retry-' + cause);
    const store = createMemoryStore(join(fixture.dir, 'failure-' + cause));
    try {
        await appendMemoryTurn(store.memory, scope, {
            userId: 401, assistantId: 402, message: '抽出対象の発言', reply: '返答',
            learning: learningMetadata(scope.userId, scope.mascotId, 'lmstudio', 'test-model', undefined, true, Date.now() - 3600000)
        });
        const filename = (await getChatDatabasePath(store.memory))!;
        const generate = vi.mocked(generateText).mockReset();
        if (cause === '不正JSON') generate.mockResolvedValue({ text: 'JSON以外の応答' } as Awaited<ReturnType<typeof generateText>>);
        else generate.mockRejectedValue(new Error('生成エラー'));
        for (let run = 0; run < 4; run++) {
            withChatDatabase(filename, db => db.prepare("UPDATE tonarice_learning_jobs SET due_at = 0 WHERE status = 'pending'").run());
            await runLearningOnce(filename, new AbortController().signal);
        }
        expect(generateText).toHaveBeenCalledTimes(3);
        expect(learningStatus(filename, scope.userId, scope.mascotId)).toEqual(['failed']);
    } finally { await store.storage.close(); }
});

test('canOfferCompanionNudge_継続セッションも最後の発話から6時間経過すると対象にする', () => {
    const now = 12 * 60 * 60000;
    expect(canOfferCompanionNudge(undefined, now)).toBe(true);
    expect(canOfferCompanionNudge(now - 6 * 60 * 60000 + 1, now)).toBe(false);
    expect(canOfferCompanionNudge(now - 6 * 60 * 60000, now)).toBe(true);
});
