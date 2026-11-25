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

export interface StoredMemo extends MemoData {
    id: string;
    order?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface MemosDbState {
    memos: StoredMemo[];
    revision: number;
}

/**
 * ユーザーの memos.json からメモ一覧とリビジョンを読み込む。
 * ファイル未作成 (ENOENT) のみ空配列・revision 0 を返し、破損 JSON・非配列・権限エラー等は送出する。
 */
export function loadMemosStateFromDb(userId: string): MemosDbState {
    const memosPath = getUserMemosPath(userId);
    let raw: string;
    try {
        raw = fs.readFileSync(memosPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { memos: [], revision: 0 };
        }
        throw error;
    }

    const data = JSON.parse(raw);
    if (!Array.isArray(data?.memos)) {
        throw new Error('memos.json の memos が配列ではありません。');
    }
    return {
        memos: data.memos,
        revision: normalizeRevision(data.revision)
    };
}

export function loadMemosFromDb(userId: string): StoredMemo[] {
    return loadMemosStateFromDb(userId).memos;
}

export function saveMemosToDb(
    userId: string,
    memos: unknown[],
    options?: { baseRevision?: number }
): { revision: number } {
    const memosPath = getUserMemosPath(userId);
    const userDir = path.dirname(memosPath);

    // 破損ファイルや権限エラーを revision 0 とみなして上書きしないよう、共通経路で読み込む。
    const currentState = loadMemosStateFromDb(userId);

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

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    const nextRevision = currentState.revision + 1;
    safeWriteFileSync(memosPath, JSON.stringify({ memos, revision: nextRevision }, null, 4));
    return { revision: nextRevision };
}

export function addMemoToDb(userId: string, payload: MemoData) {
    const memosPath = getUserMemosPath(userId);
    const userDir = path.dirname(memosPath);

    const normalizedContent = (payload.content || '').trim();
    if (!normalizedContent) {
        throw new Error('Memo content cannot be empty');
    }

    // 既存ファイルの破損・権限エラーを握りつぶさず保護する。
    const currentState = loadMemosStateFromDb(userId);

    const duplicate = currentState.memos.find((m) =>
        (m.content || '').trim() === normalizedContent
    );
    if (duplicate) {
        console.log(`[MemosDB] Duplicate add ignored (idempotent): "${normalizedContent}"`);
        return {
            memo: duplicate,
            duplicate: true,
            revision: currentState.revision
        };
    }

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    const newMemo: StoredMemo = {
        id: 'memo_' + Math.random().toString(36).substring(2, 11),
        content: normalizedContent,
        color: payload.color || 'yellow',
        pinned: payload.pinned || false,
        order: currentState.memos.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const nextMemos = [...currentState.memos, newMemo];
    const nextRevision = currentState.revision + 1;
    safeWriteFileSync(memosPath, JSON.stringify({ memos: nextMemos, revision: nextRevision }, null, 4));

    return {
        memo: newMemo,
        revision: nextRevision
    };
}

export function searchMemosFromDb(userId: string, query?: string, literalQuery = false) {
    const memos = loadMemosFromDb(userId);
    if (!query) {
        return memos;
    }

    const lowerQuery = query.toLowerCase();
    if (literalQuery || !lowerQuery.includes('*')) {
        return memos.filter(memo => memo.content?.toLowerCase().includes(lowerQuery));
    }

    const [prefix = '', ...segments] = lowerQuery.split('*');
    const suffix = segments.pop() ?? '';
    return memos.filter(memo => {
        const content = memo.content?.toLowerCase() ?? '';
        const suffixStart = content.length - suffix.length;
        if (!content.startsWith(prefix) || !content.endsWith(suffix)) {
            return false;
        }

        let offset = prefix.length;
        for (const segment of segments) {
            const index = content.indexOf(segment, offset);
            if (index === -1) {
                return false;
            }
            offset = index + segment.length;
        }
        return offset <= suffixStart;
    });
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

    const currentState = loadMemosStateFromDb(userId);
    const memos = [...currentState.memos];
    const memo = memos.find((m) => m.id === id);
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
    const nextRevision = currentState.revision + 1;

    safeWriteFileSync(memosPath, JSON.stringify({ memos, revision: nextRevision }, null, 4));

    return {
        memo,
        revision: nextRevision
    };
}

export function deleteMemoFromDb(userId: string, id: string) {
    const memosPath = getUserMemosPath(userId);
    if (!fs.existsSync(memosPath)) {
        throw new Error('Memos database does not exist.');
    }

    const currentState = loadMemosStateFromDb(userId);
    const nextMemos = currentState.memos.filter((m) => m.id !== id);

    if (nextMemos.length === currentState.memos.length) {
        throw new Error(`Memo with ID ${id} not found.`);
    }

    const nextRevision = currentState.revision + 1;
    safeWriteFileSync(memosPath, JSON.stringify({ memos: nextMemos, revision: nextRevision }, null, 4));
    return { revision: nextRevision };
}
