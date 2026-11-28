import Database from 'better-sqlite3';
import { TABLE_MESSAGES, TABLE_THREADS } from '@mastra/core/storage';
import type { Memory } from '@mastra/memory';
import type { LibSQLStore } from '@mastra/libsql';

const adapters = new WeakMap<Memory, { storage: LibSQLStore; filename: string; initialized?: Promise<void> }>();

export function registerChatSequence(memory: Memory, storage: LibSQLStore, filename: string) {
    adapters.set(memory, { storage, filename });
}

export function withChatDatabase<T>(filename: string, operation: (db: Database.Database) => T): T {
    const db = new Database(filename, { timeout: 1000 });
    try { return operation(db); } finally { db.close(); }
}

export async function getChatDatabasePath(memory: Memory): Promise<string | undefined> {
    const adapter = adapters.get(memory);
    if (!adapter) return;
    adapter.initialized ??= initialize(adapter).catch(error => {
        adapter.initialized = undefined;
        throw error;
    });
    await adapter.initialized;
    return adapter.filename;
}

async function initialize({ filename, storage }: { filename: string; storage: LibSQLStore }) {
    await storage.init();
    withChatDatabase(filename, db => db.transaction(() => {
        // 原文の保存・削除と同じトランザクションで保存順と要約の世代を更新する。
        db.exec(`
            CREATE TABLE IF NOT EXISTS tonarice_chat_sequence (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL UNIQUE,
                thread_id TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tonarice_chat_sequence_thread ON tonarice_chat_sequence(thread_id, seq);
            CREATE TABLE IF NOT EXISTS tonarice_chat_context (
                thread_id TEXT PRIMARY KEY,
                generation INTEGER NOT NULL DEFAULT 0,
                covered_seq INTEGER NOT NULL DEFAULT 0,
                summary TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS tonarice_learning_jobs (
                source_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                mascot_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                source_seq INTEGER NOT NULL,
                observed_at INTEGER NOT NULL,
                due_at INTEGER NOT NULL,
                model_settings TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                lease_token TEXT
            );
            CREATE INDEX IF NOT EXISTS tonarice_learning_due ON tonarice_learning_jobs(status, due_at);
            CREATE INDEX IF NOT EXISTS tonarice_learning_owner ON tonarice_learning_jobs(user_id, mascot_id, source_seq);
            CREATE TRIGGER IF NOT EXISTS tonarice_chat_insert AFTER INSERT ON "${TABLE_MESSAGES}"
            BEGIN
                INSERT INTO tonarice_chat_sequence (message_id, thread_id) VALUES (NEW.id, NEW.thread_id);
            END;
            CREATE TRIGGER IF NOT EXISTS tonarice_learning_insert AFTER INSERT ON tonarice_chat_sequence
            WHEN EXISTS (
                SELECT 1 FROM "${TABLE_MESSAGES}" m WHERE m.id = NEW.message_id AND m.role = 'user'
                AND CASE WHEN json_valid(m.content) THEN json_type(m.content, '$.metadata.learning') = 'object' ELSE 0 END
            )
            BEGIN
                INSERT INTO tonarice_learning_jobs
                    (source_id, user_id, mascot_id, thread_id, source_seq, observed_at, due_at, model_settings, status)
                SELECT NEW.message_id, json_extract(m.content, '$.metadata.learning.userId'),
                    json_extract(m.content, '$.metadata.learning.mascotId'), NEW.thread_id, NEW.seq,
                    json_extract(m.content, '$.metadata.learning.observedAt'),
                    json_extract(m.content, '$.metadata.learning.dueAt'),
                    json_extract(m.content, '$.metadata.learning.model'),
                    CASE WHEN json_extract(m.content, '$.metadata.learning.eligible') THEN 'pending' ELSE 'excluded' END
                FROM "${TABLE_MESSAGES}" m WHERE m.id = NEW.message_id;
                UPDATE tonarice_learning_jobs SET due_at = MAX(due_at,
                    (SELECT due_at FROM tonarice_learning_jobs WHERE source_id = NEW.message_id))
                WHERE thread_id = NEW.thread_id AND status IN ('pending', 'pending_credentials');
            END;
            CREATE TRIGGER IF NOT EXISTS tonarice_learning_delete AFTER DELETE ON "${TABLE_MESSAGES}"
            BEGIN
                DELETE FROM tonarice_learning_jobs WHERE source_id = OLD.id;
            END;
            CREATE TRIGGER IF NOT EXISTS tonarice_chat_delete AFTER DELETE ON "${TABLE_MESSAGES}"
            BEGIN
                DELETE FROM tonarice_chat_sequence WHERE message_id = OLD.id;
                INSERT INTO tonarice_chat_context (thread_id, generation) VALUES (OLD.thread_id, 1)
                ON CONFLICT(thread_id) DO UPDATE SET generation = generation + 1, covered_seq = 0, summary = '';
            END;
            CREATE TRIGGER IF NOT EXISTS tonarice_chat_update AFTER UPDATE OF content ON "${TABLE_MESSAGES}"
            WHEN OLD.content IS NOT NEW.content
            BEGIN
                INSERT INTO tonarice_chat_context (thread_id, generation) VALUES (OLD.thread_id, 1)
                ON CONFLICT(thread_id) DO UPDATE SET generation = generation + 1, covered_seq = 0, summary = '';
            END;
            CREATE TRIGGER IF NOT EXISTS tonarice_chat_thread_delete AFTER DELETE ON "${TABLE_THREADS}"
            BEGIN
                INSERT INTO tonarice_chat_context (thread_id, generation) VALUES (OLD.id, 1)
                ON CONFLICT(thread_id) DO UPDATE SET generation = generation + 1, covered_seq = 0, summary = '';
            END;
        `);
        const jobColumns = new Set((db.pragma('table_info(tonarice_learning_jobs)') as { name: string }[]).map(column => column.name));
        if (!jobColumns.has('attempts')) db.exec('ALTER TABLE tonarice_learning_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
        if (!jobColumns.has('lease_token')) db.exec('ALTER TABLE tonarice_learning_jobs ADD COLUMN lease_token TEXT');
        db.exec('CREATE INDEX IF NOT EXISTS tonarice_learning_thread ON tonarice_learning_jobs(thread_id, status, due_at, source_seq)');
        db.exec(`
            INSERT INTO tonarice_chat_sequence (message_id, thread_id)
            SELECT m.id, m.thread_id FROM "${TABLE_MESSAGES}" m
            WHERE NOT EXISTS (SELECT 1 FROM tonarice_chat_sequence s WHERE s.message_id = m.id)
            ORDER BY m."createdAt", m.id;
        `);
    }).immediate());
}

export interface ChatSequenceState { generation: number; coveredSeq: number; summary: string }

export function readChatSequence(filename: string, threadId: string) {
    return withChatDatabase(filename, db => db.transaction(() => {
        const state = db.prepare(`
            SELECT generation, covered_seq AS coveredSeq, summary FROM tonarice_chat_context WHERE thread_id = ?
        `).get(threadId) as ChatSequenceState | undefined;
        const sequence = db.prepare('SELECT message_id AS id, seq FROM tonarice_chat_sequence WHERE thread_id = ? ORDER BY seq')
            .all(threadId) as { id: string; seq: number }[];
        return { state: state ?? { generation: 0, coveredSeq: 0, summary: '' }, sequence };
    })());
}

export function saveChatSummary(filename: string, threadId: string, previous: ChatSequenceState, coveredSeq: number, summary: string) {
    return withChatDatabase(filename, db => db.prepare(`
        INSERT INTO tonarice_chat_context (thread_id, generation, covered_seq, summary)
        SELECT ?, ?, ?, ? WHERE ? = COALESCE((SELECT generation FROM tonarice_chat_context WHERE thread_id = ?), 0)
        ON CONFLICT(thread_id) DO UPDATE SET covered_seq = excluded.covered_seq, summary = excluded.summary
        WHERE generation = excluded.generation AND covered_seq = ?
    `).run(threadId, previous.generation, coveredSeq, summary, previous.generation, threadId, previous.coveredSeq).changes === 1);
}
