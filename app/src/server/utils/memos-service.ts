import * as fs from 'fs';
import * as path from 'path';
import { USERS_DIR } from './paths';
import { safeWriteFileSync } from './fs-helpers';

function getUserMemosPath(userId: string): string {
    return path.join(USERS_DIR, userId, 'memos.json');
}

export interface MemoData {
    content: string;
    color?: string;
    pinned?: boolean;
}

export function loadMemosFromDb(userId: string): Array<MemoData & { id: string }> {
    const memosPath = getUserMemosPath(userId);
    let raw: string;
    try {
        raw = fs.readFileSync(memosPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const data = JSON.parse(raw);
    if (!Array.isArray(data?.memos)) {
        throw new Error('memos.json の memos が配列ではありません。');
    }
    return data.memos;
}

export function saveMemosToDb(userId: string, memos: unknown[]) {
    const memosPath = getUserMemosPath(userId);
    const userDir = path.dirname(memosPath);

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    safeWriteFileSync(memosPath, JSON.stringify({ memos }, null, 4));
}

export function addMemoToDb(userId: string, payload: MemoData) {
    const memosPath = getUserMemosPath(userId);
    const userDir = path.dirname(memosPath);

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    let data = {
        memos: [] as any[]
    };

    if (fs.existsSync(memosPath)) {
        try {
            const raw = fs.readFileSync(memosPath, 'utf8');
            data = { ...data, ...JSON.parse(raw) };
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
            duplicate: true
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
    safeWriteFileSync(memosPath, JSON.stringify(data, null, 4));

    return {
        memo: newMemo
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

    safeWriteFileSync(memosPath, JSON.stringify(data, null, 4));

    return {
        memo
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

    safeWriteFileSync(memosPath, JSON.stringify(data, null, 4));
}
