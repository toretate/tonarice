import { randomUUID } from 'node:crypto';
import { TABLE_MESSAGES } from '@mastra/core/storage';
import type Database from 'better-sqlite3';
import { withChatDatabase } from './chat-sequence';

interface LearningJob {
    source_id: string;
    user_id: string;
    mascot_id: string;
    thread_id: string;
    source_seq: number;
    observed_at: number;
    model_settings: string;
}
export interface LearningEvidence {
    id: string;
    seq: number;
    observedAt: number;
    text: string;
}
interface LearningBatch {
    token: string;
    head: LearningJob;
    ids: string[];
    evidence: LearningEvidence[];
}

const limit = 3000;
const maxAttempts = 3;
const available = "j.status IN ('pending', 'pending_credentials', 'running') AND j.due_at <= ?";

function fitEvidence(text: string, budget: number) {
    const chars: string[] = [];
    for (const char of text) {
        budget -= JSON.stringify(char).length - 2;
        if (budget < 0) break;
        chars.push(char);
    }
    return chars.join('');
}

export function claimLearningBatch(filename: string, now = Date.now()): LearningBatch | undefined {
    return withChatDatabase(filename, db => db.transaction(() => {
        const head = db.prepare(`
            SELECT j.* FROM tonarice_learning_jobs j
            WHERE ${available} AND NOT EXISTS (
                SELECT 1 FROM tonarice_learning_jobs r WHERE r.thread_id = j.thread_id
                AND r.status = 'running' AND r.due_at > ?
            )
            ORDER BY j.due_at, j.source_seq LIMIT 1
        `).get(now, now) as LearningJob | undefined;
        if (!head) return;
        const rows = db.prepare(`
            SELECT j.*, substr((
                SELECT group_concat(json_extract(part.value, '$.text'), char(10))
                FROM json_each(m.content, '$.parts') part WHERE json_extract(part.value, '$.type') = 'text'
            ), 1, ?) AS evidence
            FROM tonarice_learning_jobs j
            JOIN "${TABLE_MESSAGES}" m ON m.id = j.source_id AND m.thread_id = j.thread_id AND m.role = 'user'
            WHERE ${available} AND j.user_id = ? AND j.mascot_id = ? AND j.thread_id = ?
            ORDER BY j.source_seq LIMIT 24
        `).all(limit, now, head.user_id, head.mascot_id, head.thread_id) as (LearningJob & { evidence: string | null })[];
        const ids: string[] = [];
        const evidence: LearningEvidence[] = [];
        let remaining = limit - '{"userEvidence":[]}'.length;
        for (const row of rows) {
            const content = row.evidence?.trim() ?? '';
            const index = evidence.length + 1;
            const size = JSON.stringify({ index, text: content }).length + 1;
            if (content && evidence.length && size > remaining) break;
            ids.push(row.source_id);
            if (content) {
                const overhead = JSON.stringify({ index, text: '' }).length + 1;
                const text = size <= remaining ? content : fitEvidence(content, remaining - overhead);
                evidence.push({ id: row.source_id, seq: row.source_seq, observedAt: row.observed_at, text });
                remaining -= JSON.stringify({ index, text }).length + 1;
            }
        }
        if (!ids.length) return;
        const token = randomUUID();
        const claim = db.prepare("UPDATE tonarice_learning_jobs SET status = 'running', due_at = ?, lease_token = ? WHERE source_id = ?");
        for (const id of ids) claim.run(now + 45000, token, id);
        return { token, head, ids, evidence };
    }).immediate());
}

export function finishLearningBatch(filename: string, token: string, status: string, delay = 0, failed = false) {
    withChatDatabase(filename, db => db.prepare(`
        UPDATE tonarice_learning_jobs SET
            status = CASE WHEN ? AND attempts + 1 >= ? THEN 'failed' ELSE ? END,
            attempts = attempts + ?, due_at = ?, lease_token = NULL
        WHERE lease_token = ? AND status = 'running'
    `).run(Number(failed), maxAttempts, status, Number(failed), Date.now() + delay, token));
}

export function canCommitLearningBatch(filename: string, batch: LearningBatch, generation: number, chosen: string) {
    return withChatDatabase(filename, db => db.transaction(() => {
        const claimed = db.prepare(`
            SELECT COUNT(*) AS count FROM tonarice_learning_jobs j
            JOIN "${TABLE_MESSAGES}" m ON m.id = j.source_id AND m.thread_id = j.thread_id
            LEFT JOIN tonarice_chat_context c ON c.thread_id = j.thread_id
            WHERE j.lease_token = ? AND j.status = 'running' AND COALESCE(c.generation, 0) = ? AND j.due_at > ?
        `).get(batch.token, generation, Date.now()) as { count: number };
        return claimed.count === batch.ids.length && latestLearningModel(db, batch.head.user_id, batch.head.mascot_id) === chosen;
    })());
}

export function latestLearningModel(db: Database.Database, owner: string, mascot: string) {
    const row = db.prepare(`
        SELECT model_settings FROM tonarice_learning_jobs WHERE user_id = ? AND mascot_id = ? ORDER BY source_seq DESC LIMIT 1
    `).get(owner, mascot) as { model_settings: string } | undefined;
    return row?.model_settings;
}
