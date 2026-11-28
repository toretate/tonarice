import { TABLE_MESSAGES, TABLE_THREADS } from '@mastra/core/storage';
import type Database from 'better-sqlite3';
import { withChatDatabase } from './chat-sequence';
import { createMemoryIdentity } from './memory-store';
import { searchMemosFromDb } from '../utils/memos-service';
import { searchTasksFromDb } from '../utils/tasks-service';

export interface KeywordHit {
    kind: 'conversation' | 'memo' | 'task';
    id: string;
    text: string;
    sessionId?: string;
    title?: string;
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const wordSegments = new Intl.Segmenter('ja', { granularity: 'word' });
const ignored = new Set(['これ', 'それ', '前', 'どこ', 'いつ', '何', '教え', '探し', 'ます', 'する', 'した', '最初', '前回', 'について']);

export function keywordTerms(query: string) {
    return [...new Set(normalize(query).split(/[^\p{L}\p{N}_ー]+/u).flatMap(part => {
        if (!part) return [];
        const words = [...wordSegments.segment(part)].filter(value => value.isWordLike && !ignored.has(value.segment));
        return words.length > 1 ? [part, ...words.map(value => value.segment).filter(word => [...word].length >= 2)] : [part];
    }))].slice(0, 12);
}

function initializeSearch(db: Database.Database) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tonarice_keyword_checkpoint (
            resource_id TEXT PRIMARY KEY,
            seq INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tonarice_keyword_document (
            seq INTEGER PRIMARY KEY,
            message_id TEXT UNIQUE NOT NULL,
            resource_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            normalized TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tonarice_keyword_resource ON tonarice_keyword_document(resource_id, seq);
        CREATE VIRTUAL TABLE IF NOT EXISTS tonarice_keyword_fts USING fts5(normalized, tokenize = 'trigram');
        CREATE TRIGGER IF NOT EXISTS tonarice_keyword_document_insert AFTER INSERT ON tonarice_keyword_document
        BEGIN
            INSERT INTO tonarice_keyword_fts (rowid, normalized) VALUES (NEW.seq, NEW.normalized);
        END;
        CREATE TRIGGER IF NOT EXISTS tonarice_keyword_document_delete AFTER DELETE ON tonarice_keyword_document
        BEGIN
            DELETE FROM tonarice_keyword_fts WHERE rowid = OLD.seq;
        END;
        CREATE TRIGGER IF NOT EXISTS tonarice_keyword_document_update AFTER UPDATE OF normalized ON tonarice_keyword_document
        BEGIN
            DELETE FROM tonarice_keyword_fts WHERE rowid = OLD.seq;
            INSERT INTO tonarice_keyword_fts (rowid, normalized) VALUES (NEW.seq, NEW.normalized);
        END;
        CREATE TRIGGER IF NOT EXISTS tonarice_keyword_delete_source AFTER DELETE ON "${TABLE_MESSAGES}"
        BEGIN
            DELETE FROM tonarice_keyword_document WHERE message_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS tonarice_keyword_update_source AFTER UPDATE OF content ON "${TABLE_MESSAGES}"
        WHEN OLD.content IS NOT NEW.content
        BEGIN
            DELETE FROM tonarice_keyword_document WHERE message_id = OLD.id;
            UPDATE tonarice_keyword_checkpoint SET seq = 0 WHERE resource_id = OLD."resourceId";
        END;
    `);
}

function sourceText(content: string) {
    try {
        const value = JSON.parse(content) as { parts?: { type: string; text?: string }[] };
        return value.parts?.flatMap(part => part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n') ?? '';
    } catch { return ''; }
}

function indexResource(db: Database.Database, resource: string, signal?: AbortSignal) {
    const after = db.prepare('SELECT seq FROM tonarice_keyword_checkpoint WHERE resource_id = ?').get(resource) as { seq: number } | undefined;
    const query = db.prepare(`
        SELECT s.seq, s.message_id, s.thread_id, m.content
        FROM tonarice_chat_sequence s JOIN "${TABLE_MESSAGES}" m ON m.id = s.message_id
        JOIN "${TABLE_THREADS}" t ON t.id = s.thread_id
        WHERE s.seq > ? AND m.role IN ('user', 'assistant') AND t."resourceId" = ? AND m."resourceId" = ?
        ORDER BY s.seq LIMIT 500
    `);
    const upsert = db.prepare(`
        INSERT INTO tonarice_keyword_document (seq, message_id, resource_id, thread_id, normalized) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(seq) DO UPDATE SET normalized = excluded.normalized WHERE normalized IS NOT excluded.normalized
    `);
    const checkpoint = db.prepare(`
        INSERT INTO tonarice_keyword_checkpoint (resource_id, seq) VALUES (?, ?)
        ON CONFLICT(resource_id) DO UPDATE SET seq = MAX(seq, excluded.seq)
    `);
    let seq = after?.seq ?? 0;
    const deadline = performance.now() + 600;
    while (performance.now() < deadline) {
        const rows = query.all(seq, resource, resource) as { seq: number; message_id: string; thread_id: string; content: string }[];
        for (const row of rows) {
            signal?.throwIfAborted();
            if (performance.now() > deadline) break;
            seq = row.seq;
            upsert.run(row.seq, row.message_id, resource, row.thread_id, normalize(sourceText(row.content)));
        }
        if (rows.length < 500) break;
    }
    checkpoint.run(resource, seq);
}

export function searchConversationKeywords(filename: string, owner: string, mascot: string, currentThread: string,
    terms: string[], signal?: AbortSignal
): KeywordHit[] {
    if (!terms.length) return [];
    const { resource } = createMemoryIdentity(owner, mascot, 'search', false);
    const long = terms.filter(term => [...term].length >= 3);
    const short = terms.filter(term => [...term].length < 3);
    const deadline = performance.now() + 1200;
    return withChatDatabase(filename, db => db.transaction(() => {
        signal?.throwIfAborted();
        initializeSearch(db);
        indexResource(db, resource, signal);
        if (performance.now() > deadline) return [];
        const where: string[] = [];
        const args: (number | string)[] = [];
        if (long.length) {
            where.push('d.seq IN (SELECT rowid FROM tonarice_keyword_fts WHERE tonarice_keyword_fts MATCH ?)');
            args.push(long.map(term => '"' + term.replace(/"/g, '""') + '"').join(' OR '));
        }
        if (short.length) {
            where.push('(' + short.map(() => 'instr(d.normalized, ?) > 0').join(' OR ') + ')');
            args.push(...short);
        }
        // 索引の内容は返さず、同じスコープに残る原文を照合して返す。
        const score = terms.map(() => '(instr(d.normalized, ?) > 0)').join(' + ');
        const rows = db.prepare(`
            SELECT d.message_id AS id, m.content, t.title, json_extract(t.metadata, '$.sessionId') AS session_id,
                ${score} AS matches
            FROM tonarice_keyword_document d
            JOIN "${TABLE_MESSAGES}" m ON m.id = d.message_id AND m.thread_id = d.thread_id AND m."resourceId" = d.resource_id
            JOIN "${TABLE_THREADS}" t ON t.id = d.thread_id AND t."resourceId" = d.resource_id
            WHERE d.resource_id = ? AND d.thread_id <> ? AND (${where.join(' OR ')})
            ORDER BY matches DESC, d.seq DESC LIMIT 8
        `).all(...terms, resource, currentThread, ...args) as { id: string; content: string; title?: string; session_id?: string }[];
        return rows.map((row): KeywordHit => ({
            kind: 'conversation', id: row.id, text: sourceText(row.content).slice(0, 600),
            title: row.title, sessionId: row.session_id ?? undefined
        }));
    }).immediate());
}

export function searchSharedKeywords(owner: string, terms: string[]): KeywordHit[] {
    if (!terms.length) return [];
    const memos: KeywordHit[] = searchMemosFromDb(owner).map(item => ({
        kind: 'memo', id: item.id, text: item.content ?? ''
    }));
    const tasks: KeywordHit[] = searchTasksFromDb(owner).map((item: { id: string; title?: string; description?: string }) => ({
        kind: 'task', id: item.id, text: [item.title, item.description].filter(Boolean).join('\n')
    }));
    return [memos, tasks].flatMap(source => source.map(item => {
        const text = normalize(item.text);
        return { item, score: terms.filter(term => text.includes(term)).length };
    }).filter(item => item.score).sort((a, b) => b.score - a.score).slice(0, 4)
        .map(({ item }) => ({ ...item, text: item.text.slice(0, 600) })));
}
