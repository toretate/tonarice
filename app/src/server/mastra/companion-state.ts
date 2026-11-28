import type { MascotFiles } from '../utils/mascot-file-transaction';

export interface MemorySource { id: string; observedAt: number; seq: number; sourceIds?: string[] }
export interface MemoryCandidate {
    kind: 'user' | 'memory' | 'condition' | 'concern' | 'resolved';
    key: string;
    text: string;
    source?: MemorySource;
}
export interface CompanionItem extends Omit<MemoryCandidate, 'kind' | 'source'> {
    id: string;
    kind: Exclude<MemoryCandidate['kind'], 'resolved'>;
    source: MemorySource;
    expiresAt?: number;
    lastNudgedAt?: number;
    nudgeCount?: number;
}
export interface Delta { id: string; before?: CompanionItem; after?: CompanionItem }
interface Revision { id: string; timestamp: number; source: MemorySource; changes: Delta[] }
export interface PulseState {
    enabled: boolean;
    items: CompanionItem[];
    deleted: Record<string, number>;
    revisions: Revision[];
    nudgeReservation?: { token: string; itemId: string; expiresAt: number };
}

export function readPulse(content: string | undefined): PulseState {
    return content ? JSON.parse(content) as PulseState : { enabled: true, items: [], deleted: {}, revisions: [] };
}

export function serializePulse(state: PulseState): string {
    return JSON.stringify(state, null, 4) + '\n';
}

export function sourceExists(source: MemorySource, existing: ReadonlySet<string>): boolean {
    return (source.sourceIds ?? [source.id]).every(id => existing.has(id));
}

/** マーカーごと手動削除された項目は復元候補からも外す。内容だけが編集されたブロックは競合保護を維持する。 */
export function reconcileRemovedBlocks(state: PulseState, markdown: MascotFiles) {
    const removed = state.items.filter(item => {
        const document = item.kind === 'user' ? markdown['user.md'] : item.kind === 'memory' ? markdown['memory.md'] : undefined;
        return document !== undefined && !document.includes('<!-- tonarice-memory:' + item.id + ' -->')
            && !document.includes('<!-- /tonarice-memory:' + item.id + ' -->');
    });
    if (!removed.length) return false;
    const ids = new Set(removed.map(item => item.id));
    for (const item of removed) state.deleted[item.id] = Math.max(state.deleted[item.id] ?? 0, item.source.seq);
    state.items = state.items.filter(item => !ids.has(item.id));
    state.revisions = state.revisions.flatMap(revision => {
        const changes = revision.changes.filter(change => !ids.has(change.id));
        return changes.length ? [{ ...revision, changes }] : [];
    });
    return true;
}

export function reconcileManualPromptSave(previous: MascotFiles, next: MascotFiles): MascotFiles {
    if (!previous['pulse.json']) return next;
    const state = readPulse(previous['pulse.json']);
    return reconcileRemovedBlocks(state, next) ? { ...next, 'pulse.json': serializePulse(state) } : next;
}
