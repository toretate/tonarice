import type { Ref } from 'vue';

type Snapshot = Record<string, unknown>;
type Row = { id: string };

/**
 * JSON シリアライズ後の構造を正規化する。
 * オブジェクトのキー順を揃えつつ、配列の要素順はそのまま保持する。
 */
function canonicalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(item => canonicalizeJson(item));
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(record)
                .sort()
                .filter(key => record[key] !== undefined)
                .map(key => [key, canonicalizeJson(record[key])])
        );
    }
    return value;
}

/**
 * 実際の送信時の JSON 正規化（undefined 除去・toJSON 適用等）に合わせて比較する。
 */
function normalizeForComparison(value: unknown): unknown {
    if (value === undefined) return undefined;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return canonicalizeJson(JSON.parse(serialized));
}

export function jsonEqual(left: unknown, right: unknown): boolean {
    const normalizedLeft = normalizeForComparison(left);
    const normalizedRight = normalizeForComparison(right);
    if (normalizedLeft === undefined && normalizedRight === undefined) return true;
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function mergeFields(base: Snapshot, local: Snapshot, remote: Snapshot): Snapshot {
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    const merged: Snapshot = {};
    for (const key of keys) {
        const value = jsonEqual(base[key], local[key]) ? remote[key] : local[key];
        if (value !== undefined) {
            merged[key] = value;
        }
    }
    return merged;
}

function mergeRows(base: Row[], local: Row[], remote: Row[]): Row[] {
    const original = new Map(base.map(row => [row.id, row]));
    const edits = new Map(local.map(row => [row.id, row]));
    const result = new Map(remote.map(row => [row.id, row]));
    for (const [id, before] of original) {
        const after = edits.get(id);
        if (!after) {
            result.delete(id);
        } else if (!jsonEqual(before, after)) {
            const latest = result.get(id);
            result.set(id, latest ? { id, ...mergeFields({ ...before }, { ...after }, { ...latest }) } : after);
        }
    }
    for (const [id, row] of edits) if (!original.has(id)) result.set(id, row);
    return Array.from(result.values());
}

export function createRevisionSave(options: {
    url: string;
    revision: Ref<number | null>;
    read: () => Snapshot;
    apply: (snapshot: Snapshot) => void;
    collections: string[];
}) {
    let base: Snapshot = {};
    let pending: Promise<void> | undefined;
    let retryAfterRemoteSync = false;

    // POST と同じ JSON 形式で比較し、Vue のリアクティブな参照を切り離す。
    const snapshot = (value: Snapshot) => JSON.parse(JSON.stringify(value)) as Snapshot;

    function select(data: Snapshot): Snapshot {
        const local = options.read();
        return Object.fromEntries(Object.keys(local).map(key => [key, data[key] ?? base[key] ?? local[key]]));
    }

    function adopt(data: Snapshot, revision: number) {
        base = snapshot(select(data));
        options.revision.value = revision;
    }

    function mergeRemote(data: Snapshot, revision: number, allowResync = true) {
        const remote = snapshot(select(data));
        const local = snapshot(options.read());
        const merged = mergeFields(base, local, remote);
        for (const key of options.collections) {
            merged[key] = mergeRows((base[key] ?? []) as Row[], (local[key] ?? []) as Row[], (remote[key] ?? []) as Row[]);
        }
        adopt(remote, revision);
        options.apply(merged);

        if (allowResync && retryAfterRemoteSync && !pending) {
            if (!jsonEqual(merged, remote)) {
                retryAfterRemoteSync = false;
                pending ??= drain();
            } else {
                retryAfterRemoteSync = false;
            }
        }
    }

    async function drain() {
        // 同じ操作で更新された複数の項目をまとめてから保存する。
        await Promise.resolve();
        let retries = 0;
        try {
            while (options.revision.value !== null) {
                const next = snapshot(options.read());
                if (jsonEqual(next, base)) {
                    retryAfterRemoteSync = false;
                    return;
                }
                const response = await fetch(options.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ ...next, baseRevision: options.revision.value })
                });
                const result = await response.json().catch(() => null);
                if (response.status === 409 && Number.isSafeInteger(result?.data?.currentRevision) && retries < 3) {
                    retries++;
                    mergeRemote(result.data, result.data.currentRevision, false);
                    continue;
                }
                if (!response.ok || !Number.isSafeInteger(result?.revision)) {
                    retryAfterRemoteSync = true;
                    throw new Error('変更は端末に保持されています。次の編集またはサーバー同期時に再試行します。');
                }
                adopt(next, result.revision);
                retryAfterRemoteSync = false;
                retries = 0;
            }
        } catch (error) {
            retryAfterRemoteSync = true;
            console.warn('保存の同期に失敗しました。', error);
        } finally {
            pending = undefined;
        }
    }

    return {
        adopt,
        mergeRemote,
        applyDelta(revision: number, change: (data: Snapshot) => Snapshot) {
            mergeRemote(change(base), revision, true);
        },
        isPending: () => !!pending,
        settled: () => pending,
        request() {
            pending ??= drain();
        }
    };
}
