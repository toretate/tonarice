import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
}

/** 永続的な試行記録。書き込みに失敗した場合は操作しない。 */
export function claimMutation(directory: string, userId: string, turnId: string, name: string, input: Record<string, unknown>): boolean {
    const digest = createHash('sha256').update(JSON.stringify([userId, turnId, name, canonical(input)])).digest('hex');
    fs.mkdirSync(directory, { recursive: true });
    try {
        const fd = fs.openSync(path.join(directory, digest), 'wx', 0o600);
        try {
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
    }
}
