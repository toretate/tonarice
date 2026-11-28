import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { USERS_DIR } from '../utils/paths';
import { isOwnedMascot } from '../utils/mascot-prompts';
import { useMascotFiles, type MascotFiles } from '../utils/mascot-file-transaction';
import { readPulse, reconcileRemovedBlocks, serializePulse, sourceExists, type CompanionItem, type Delta, type MemoryCandidate, type MemorySource, type PulseState } from './companion-state';

const day = 86400000;
const docs = ['user.md', 'memory.md', 'pulse.json'] as const;
const itemKey = (kind: string, key: string) => createHash('sha256').update(kind + ':' + key.normalize('NFKC').trim().toLowerCase()).digest('hex').slice(0, 24);
const directoryOf = (owner: string, mascot: string) => join(USERS_DIR, owner, 'mascots', mascot);
const version = (files: MascotFiles) => createHash('sha256').update(JSON.stringify(docs.map(name => files[name] ?? null))).digest('hex');

function managedBlock(item: CompanionItem) {
    return '\n\n<!-- tonarice-memory:' + item.id + ' -->\n' + item.text + '\n<!-- /tonarice-memory:' + item.id + ' -->';
}

function applyBlocks(files: MascotFiles, changes: Delta[], removeEdited = false): MascotFiles | undefined {
    const result: MascotFiles = {};
    for (const { before, after } of changes) {
        const kind = (after ?? before)?.kind;
        if (kind !== 'user' && kind !== 'memory') continue;
        const name = kind === 'user' ? 'user.md' : 'memory.md';
        let text = result[name] ?? files[name] ?? '';
        if (before) {
            const block = managedBlock(before);
            const marker = '<!-- tonarice-memory:' + before.id + ' -->';
            if (!text.includes(block) && !removeEdited) return;
            const start = text.indexOf(marker);
            const close = '<!-- /tonarice-memory:' + before.id + ' -->';
            const end = start >= 0 ? text.indexOf(close, start + marker.length) : -1;
            if (text.includes(block)) text = text.replace(block, after ? managedBlock(after) : '');
            else if (end >= 0) text = text.slice(0, start) + text.slice(end + close.length);
        } else if (after) text += managedBlock(after);
        result[name] = text;
    }
    return result;
}

function persist(commit: (files: MascotFiles) => void, state: PulseState, docs: MascotFiles = {}) {
    commit({ ...docs, 'pulse.json': serializePulse(state) });
}

export function readCompanionSnapshot(owner: string, mascot: string) {
    if (!isOwnedMascot(owner, mascot)) return;
    return useMascotFiles(directoryOf(owner, mascot), files => ({
        version: version(files), enabled: readPulse(files['pulse.json']).enabled
    }));
}

export function updateCompanionMemory(
    owner: string, mascot: string, expectedVersion: string, batchSource: MemorySource, candidates: MemoryCandidate[], valid: () => boolean
) {
    if (!isOwnedMascot(owner, mascot)) return 'gone';
    return useMascotFiles(directoryOf(owner, mascot), (files, commit) => {
        const state = readPulse(files['pulse.json']);
        if (!state.enabled || !valid()) return 'gone';
        if (version(files) !== expectedVersion) return 'conflict';
        const reconciled = reconcileRemovedBlocks(state, { 'user.md': files['user.md'] ?? '', 'memory.md': files['memory.md'] ?? '' });
        if (reconciled) persist(commit, state);
        if (state.revisions.some(item => item.source.id === batchSource.id)) return 'done';
        const now = Date.now();
        const expired = state.items.filter(item => item.expiresAt !== undefined && item.expiresAt <= now);
        for (const item of expired) {
            if (item.kind === 'concern') state.deleted[item.id] = Math.max(state.deleted[item.id] ?? 0, item.source.seq);
        }
        state.items = state.items.filter(item => !expired.includes(item));
        const changes: Delta[] = [];
        const resolved = new Map<string, number>();
        const seen = new Set<string>();
        // 同じ項目への訂正や完了がバッチに重なった場合は、発言順が新しい根拠を使う。
        for (const candidate of [...candidates].sort((a, b) => (b.source ?? batchSource).seq - (a.source ?? batchSource).seq)) {
            const source = candidate.source ?? batchSource;
            const kind = candidate.kind === 'resolved' ? 'concern' : candidate.kind;
            const id = itemKey(kind, kind === 'condition' ? 'recent' : candidate.key);
            if (seen.has(id)) continue;
            seen.add(id);
            const before = state.items.find(item => item.id === id);
            if (before && before.source.seq >= source.seq) continue;
            if ((state.deleted[id] ?? -1) >= source.seq) continue;
            if (candidate.kind === 'resolved') {
                if (before) {
                    changes.push({ id, before });
                    resolved.set(id, source.seq);
                }
                continue;
            }
            if (before?.text === candidate.text) continue;
            if (kind === 'concern' && !before && state.items.filter(item => item.kind === kind).length
                + changes.filter(item => !item.before && item.after?.kind === kind).length >= 5) continue;
            const expiresAt = kind === 'condition' ? source.observedAt + 14 * day
                : kind === 'concern' ? before?.expiresAt ?? source.observedAt + 21 * day : undefined;
            if (expiresAt !== undefined && expiresAt <= now) continue;
            changes.push({ id, before, after: {
                id, kind, key: candidate.key, text: candidate.text, source, expiresAt,
                lastNudgedAt: before?.lastNudgedAt, nudgeCount: before?.nudgeCount
            } });
        }
        if (!changes.length) {
            if (expired.length) persist(commit, state);
            return 'done';
        }
        const documentChanges = applyBlocks(files, changes);
        if (!documentChanges) return 'needs_review';
        for (const name of ['user.md', 'memory.md'] as const) {
            const original = files[name]?.length ?? 0;
            if (original && documentChanges[name] !== undefined && documentChanges[name].length < original * 0.75) return 'needs_review';
        }
        state.items = state.items.filter(item => !changes.some(change => change.id === item.id));
        for (const change of changes) {
            if (change.after) state.items.push(change.after);
            else state.deleted[change.id] = resolved.get(change.id) ?? batchSource.seq;
        }
        state.revisions = [...state.revisions.slice(-19), { id: randomUUID(), timestamp: Date.now(), source: batchSource, changes }];
        persist(commit, state, documentChanges);
        return 'updated';
    });
}

export function purgeCompanionSources(owner: string, mascot: string, loadExisting: () => ReadonlySet<string>) {
    if (!isOwnedMascot(owner, mascot)) return;
    useMascotFiles(directoryOf(owner, mascot), (files, commit) => {
        if (!files['pulse.json']) return;
        const state = readPulse(files['pulse.json']);
        const existing = loadExisting();
        const removed = state.items.filter(item => !sourceExists(item.source, existing));
        const revisions = state.revisions.filter(revision => sourceExists(revision.source, existing)
            && revision.changes.every(change => (!change.before || sourceExists(change.before.source, existing))
                && (!change.after || sourceExists(change.after.source, existing))));
        if (!removed.length && revisions.length === state.revisions.length) return;
        state.items = state.items.filter(item => sourceExists(item.source, existing));
        state.revisions = revisions;
        persist(commit, state, applyBlocks(files, removed.map(item => ({ id: item.id, before: item })), true));
    });
}

export function getCompanionState(owner: string, mascot: string) {
    if (!isOwnedMascot(owner, mascot)) return;
    return useMascotFiles(directoryOf(owner, mascot), files => {
        const state = readPulse(files['pulse.json']);
        return {
            enabled: state.enabled,
            concerns: state.items.filter(item => item.kind === 'concern' && (item.expiresAt ?? 0) > Date.now())
                .map(({ id, text, expiresAt }) => ({ id, text, expiresAt })),
            revision: state.revisions.at(-1) && { id: state.revisions.at(-1)!.id, timestamp: state.revisions.at(-1)!.timestamp }
        };
    });
}

export function editCompanionState(owner: string, mascot: string, action:
    { enabled: boolean } | { deleteId: string } | { undoId: string }
) {
    if (!isOwnedMascot(owner, mascot)) return 'gone';
    return useMascotFiles(directoryOf(owner, mascot), (files, commit) => {
        const state = readPulse(files['pulse.json']);
        if ('enabled' in action) {
            state.enabled = action.enabled;
        } else if ('deleteId' in action) {
            const item = state.items.find(item => item.kind === 'concern' && item.id === action.deleteId);
            if (!item) return 'gone';
            state.items = state.items.filter(value => value.id !== item.id);
            state.deleted[item.id] = Number.MAX_SAFE_INTEGER;
        } else {
            const revision = state.revisions.find(item => item.id === action.undoId);
            if (!revision) return 'gone';
            const reverse = revision.changes.map(change => ({ id: change.id, before: change.after, after: change.before }));
            if (revision.changes.some(change => {
                const live = state.items.find(item => item.id === change.id);
                return live?.source.id !== change.after?.source.id
                    || (state.deleted[change.id] ?? 0) > revision.source.seq;
            })) return 'conflict';
            const documentChanges = applyBlocks(files, reverse);
            if (!documentChanges) return 'conflict';
            for (const change of reverse) {
                const live = state.items.find(item => item.id === change.id);
                state.items = state.items.filter(item => item.id !== change.id);
                if (change.after && (change.after.expiresAt === undefined || change.after.expiresAt > Date.now())) {
                    const item = { ...change.after };
                    if (item.kind === 'concern' && live) {
                        item.nudgeCount = Math.max(item.nudgeCount ?? 0, live.nudgeCount ?? 0);
                        item.lastNudgedAt = Math.max(item.lastNudgedAt ?? 0, live.lastNudgedAt ?? 0);
                    }
                    state.items.push(item);
                }
                state.deleted[change.id] = revision.source.seq;
            }
            state.revisions = state.revisions.filter(item => item.id !== revision.id);
            persist(commit, state, documentChanges);
            return 'done';
        }
        persist(commit, state);
        return 'done';
    });
}

export function reserveCompanionContext(owner: string, mascot: string, mayNudge: boolean) {
    if (!isOwnedMascot(owner, mascot)) return;
    return useMascotFiles(directoryOf(owner, mascot), (files, commit) => {
        const now = Date.now();
        const state = readPulse(files['pulse.json']);
        const condition = state.items.find(item => item.kind === 'condition' && (item.expiresAt ?? 0) > now);
        const reserved = (state.nudgeReservation?.expiresAt ?? 0) > now;
        const concern = mayNudge && !reserved ? state.items.find(item => item.kind === 'concern'
            && (item.expiresAt ?? 0) > now && (item.nudgeCount ?? 0) < 3
            && now - (item.lastNudgedAt ?? 0) >= day) : undefined;
        const token = concern ? randomUUID() : undefined;
        if (concern && token) {
            // 生成とツール承認が終わるまで同じマスコットの候補を予約する。
            state.nudgeReservation = { token, itemId: concern.id, expiresAt: now + 10 * 60000 };
            persist(commit, state);
        }
        return { condition: condition?.text, concern: concern?.text, token };
    });
}

export function finishCompanionNudge(owner: string, mascot: string, token: string, delivered: boolean) {
    if (!isOwnedMascot(owner, mascot)) return;
    useMascotFiles(directoryOf(owner, mascot), (files, commit) => {
        const state = readPulse(files['pulse.json']);
        const reservation = state.nudgeReservation;
        if (reservation?.token !== token) return;
        delete state.nudgeReservation;
        const now = Date.now();
        if (delivered && reservation.expiresAt > now) {
            const concern = state.items.find(item => item.kind === 'concern' && item.id === reservation.itemId && (item.expiresAt ?? 0) > now);
            if (concern) {
                concern.nudgeCount = (concern.nudgeCount ?? 0) + 1;
                concern.lastNudgedAt = now;
            }
        }
        persist(commit, state);
    });
}
