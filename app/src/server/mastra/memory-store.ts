import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { STORAGE_DIR } from '../utils/paths';
import { registerChatSequence } from './chat-sequence';

/** 利用者の実際の識別子をDBのキーに直接含めず、各スコープを明確に分離する。 */
export function createMemoryIdentity(userId: string, mascotId: string, sessionId: string, isSecret: boolean): { resource: string; thread: string } {
    if (!userId || !mascotId || !sessionId) throw new Error('Memoryの識別情報が不足しています。');
    const digest = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    const resource = `resource-${digest([userId, mascotId, isSecret])}`;
    return { resource, thread: `thread-${digest([resource, sessionId])}` };
}

/** 会話履歴専用のローカルストレージを作成する。 */
export function createMemoryStore(storageDirectory = STORAGE_DIR): { memory: Memory; storage: LibSQLStore } {
    const directory = join(storageDirectory, 'mastra');
    mkdirSync(directory, { recursive: true });
    const filename = join(directory, 'memory.db');
    const storage = new LibSQLStore({ id: 'tonarice-memory', url: pathToFileURL(filename).href });
    const memory = new Memory({ storage, options: { lastMessages: 10 } });
    registerChatSequence(memory, storage, filename);
    return { memory, storage };
}

let sharedStore: ReturnType<typeof createMemoryStore> | undefined;

/** Nitroプロセス内で接続を共有する。 */
export function getMemoryStore(): ReturnType<typeof createMemoryStore> {
    sharedStore ??= createMemoryStore();
    return sharedStore;
}
