import { createError, defineEventHandler, readBody } from 'h3';
import { executeMemosTool, executeTasksTool } from '../utils/tool-executor';
import { updateTaskInDb } from '../utils/tasks-service';
import { broadcastToUser } from '../utils/user-connections';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { USERS_DIR } from '../utils/paths';

export default defineEventHandler(async event => {
    const userId = event.context.user?.id;
    if (!userId) throw createError({ statusCode: 401 });
    const body = await readBody(event);
    if (!body || !['memo', 'todo'].includes(body.kind) || !['add', 'update', 'delete'].includes(body.action)
        || typeof body.id !== 'undefined' && (typeof body.id !== 'string' || !body.id || body.id.length > 200)
        || typeof body.text !== 'undefined' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000)
        || typeof body.completed !== 'undefined' && (body.kind !== 'todo' || typeof body.completed !== 'boolean')
        || body.action === 'add' && !body.text || body.action !== 'add' && !body.id
        || body.action === 'update' && body.kind === 'memo' && !body.text
        || body.action === 'update' && body.kind === 'todo' && !body.text && typeof body.completed !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: '入力が不正です。' });
    }
    try {
        const file = path.join(USERS_DIR, userId, body.kind === 'memo' ? 'memos.json' : 'tasks.json');
        if (fs.existsSync(file)) {
            const current = JSON.parse(fs.readFileSync(file, 'utf8'));
            const entries = body.kind === 'memo' ? current?.memos : current?.tasks;
            if (!Array.isArray(entries) || body.kind === 'todo' && !Array.isArray(current?.categories)) throw new Error('invalid data');
        }
        const result = body.kind === 'memo'
            ? await executeMemosTool(userId, { action: body.action, id: body.id, content: body.text })
            : await executeTasksTool(userId, { action: body.action, id: body.id, title: body.text, completed: body.completed });
        const parsed = JSON.parse(result);
        if (!parsed.success) throw new Error('operation failed');
        try {
            if (body.kind === 'memo') {
                broadcastToUser(userId, 'memo-action', { action: body.action, memoId: parsed.id, memo: parsed.memo });
            } else if (body.action === 'delete') {
                broadcastToUser(userId, 'task-action', { action: 'deleteTask', taskId: parsed.id });
            } else {
                const saved = updateTaskInDb(userId, parsed.id, {});
                broadcastToUser(userId, 'task-action', { action: body.action === 'add' ? 'addTask' : 'updateTask', task: saved.task, categories: saved.categories });
            }
        } catch { console.warn('[CLI] 画面同期に失敗しました。'); }
        return parsed;
    } catch {
        throw createError({ statusCode: 400, statusMessage: '指定された操作を完了できませんでした。' });
    }
});
