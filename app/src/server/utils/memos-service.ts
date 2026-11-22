import * as fs from 'fs';
import * as path from 'path';
import { USERS_DIR } from './paths';
import { safeWriteFileSync } from './fs-helpers';
import { DataRevisionConflictError, normalizeRevision } from './revision-conflict';

function getUserMemosPath(userId: string): string {
    return path.join(USERS_DIR, userId, 'memos.json');
}

export interface MemoData {
    content: string;
    color?: string;
    pinned?: boolean;
}

export interface MemosDbState {
    memos: any[];
    revision: number;
}

export function loadMemosStateFromDb(userId: string): MemosDbState {
    const memosPath = getUserMemosPath(userId);
    if (!fs.existsSync(memosPath)) {
        return { memos: [], revision: 0 };
    }

    const raw = fs.readFileSync(memosPath, 'utf8');
    const data = JSON.parse(raw);
    return {
        memos: Array.isArray(data.memos) ? data.memos : [],
        revision: normalizeRevision(data.revision)
    };
}

export function loadMemosFromDb(userId: string) {
    return loadMemosStateFromDb(userId).memos;
}

export function saveMemosToDb(
    userId: string,
    memos: unknown[],
    options?: { baseRevision?: number }
): { revision: number } {
    const memosPath = getUserMemosPath(userId);
    const userDir = path.dirname(memosPath);

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    let currentState: MemosDbState = { memos: [], revision: 0 };
    if (fs.existsSync(memosPath)) {
        try {
            currentState = loadMemosStateFromDb(userId);
        } catch (e) {
            console.error('[MemosDB] Failed to read memos.json:', e);
        }
    }

    if (
        options?.baseRevision !== undefined
        && options.baseRevision !== currentState.revision
    ) {
        throw new DataRevisionConflictError(
            'メモが他の操作で更新されています。最新状態を再読み込みしてください。',
            currentState.revision,
            { memos: currentState.memos, revision: currentState.revision }
        );
    }

    const nextRevision = currentState.revision + 1;
    safeWriteFileSync(memosPath, JSON.stringify({ memos, revision: nextRevision }, null, 4));
    return { revision: nextRevision };
}

export function addMemoToDb(userId: string, payload: MemoData) {
    const memosPath = getUserMemosPath(userId);
    const userDir = path.dirname(memosPath);

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    let data: { memos: any[]; revision: number } = {
        memos: [],
        revision: 0
    };

    if (fs.existsSync(memosPath)) {
        try {
            const raw = fs.readFileSync(memosPath, 'utf8');
            const parsed = JSON.parse(raw);
            data = {
                ...data,
                ...parsed,
                memos: Array.isArray(parsed.memos) ? parsed.memos : [],
                revision: normalizeRevision(parsed.revision)
            };
        } catch (e) {
            console.error('[MemosDB] Failed to read memos.json:', e);
        }
    }

    const normalizedContent = (payload.content || '').trim();
    if (!normalizedContent) {
        throw new Error('Memo content cannot be empty');
    }

    const duplicate = data.memos.find((m: any) =>
        (m.content || '').trim() === normalizedContent
    );
    if (duplicate) {
        console.log(`[MemosDB] Duplicate add ignored (idempotent): "${normalizedContent}"`);
        return {
            memo: duplicate,
            duplicate: true,
            revision: data.revision
        };
    }

    const newMemo = {
        id: 'memo_' + Math.random().toString(36).substring(2, 11),
        content: normalizedContent,
        color: payload.color || 'yellow',
        pinned: payload.pinned || false,
        order: data.memos.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    data.memos.push(newMemo);
    data.revision += 1;
    safeWriteFileSync(memosPath, JSON.stringify(data, null, 4));

    return {
        memo: newMemo,
        revision: data.revision
    };
}

export function searchMemosFromDb(userId: string, query?: string) {
    const memosPath = getUserMemosPath(userId);
    if (!fs.existsSync(memosPath)) {
        return [];
    }

    try {
        const raw = fs.readFileSync(memosPath, 'utf8');
        const data = JSON.parse(raw);
        let memos = data.memos || [];

        if (query) {
            const lowerQuery = query.toLowerCase();
            memos = memos.filter((m: any) => m.content && m.content.toLowerCase().includes(lowerQuery));
        }

        return memos;
    } catch (e) {
        console.error('[MemosDB] Failed to search memos:', e);
        return [];
    }
}

export function updateMemoInDb(
    userId: string,
    id: string,
    updates: {
        content?: string;
        color?: string;
        pinned?: boolean;
        order?: number;
    }
) {
    const memosPath = getUserMemosPath(userId);
    if (!fs.existsSync(memosPath)) {
        throw new Error('Memos database does not exist.');
    }

    const raw = fs.readFileSync(memosPath, 'utf8');
    const data = JSON.parse(raw);
    const memos = data.memos || [];

    const memo = memos.find((m: any) => m.id === id);
    if (!memo) {
        throw new Error(`Memo with ID ${id} not found.`);
    }

    if (updates.content !== undefined) {
        const normalizedContent = updates.content.trim();
        if (normalizedContent) {
            memo.content = normalizedContent;
        }
    }
    if (updates.color !== undefined) memo.color = updates.color;
    if (updates.pinned !== undefined) memo.pinned = updates.pinned;
    if (updates.order !== undefined) memo.order = updates.order;

    memo.updatedAt = new Date().toISOString();
    data.revision = normalizeRevision(data.revision) + 1;

    safeWriteFileSync(memosPath, JSON.stringify(data, null, 4));

    return {
        memo,
        revision: data.revision
    };
}

export function deleteMemoFromDb(userId: string, id: string) {
    const memosPath = getUserMemosPath(userId);
    if (!fs.existsSync(memosPath)) {
        throw new Error('Memos database does not exist.');
    }

    const raw = fs.readFileSync(memosPath, 'utf8');
    const data = JSON.parse(raw);
    const initialLength = data.memos.length;
    data.memos = data.memos.filter((m: any) => m.id !== id);

    if (data.memos.length === initialLength) {
        throw new Error(`Memo with ID ${id} not found.`);
    }

    data.revision = normalizeRevision(data.revision) + 1;
    safeWriteFileSync(memosPath, JSON.stringify(data, null, 4));
    return { revision: data.revision };
}
