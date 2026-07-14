import { addTaskToDb, searchTasksFromDb, updateTaskInDb, deleteTaskFromDb } from './tasks-service';
import { addMemoToDb, searchMemosFromDb, updateMemoInDb, deleteMemoFromDb } from './memos-service';
import { formatTaskSearchResults, formatMemoSearchResults } from './tool-formatters';

export interface TasksToolArgs {
    action: 'add' | 'search' | 'update' | 'delete';
    title?: string;
    scheduledAt?: string | null;
    priority?: 'normal' | 'star' | 'thunder';
    categoryId?: string;
    id?: string;
    query?: string;
    date?: string;
    completed?: boolean;
}

export interface MemosToolArgs {
    action: 'add' | 'search' | 'update' | 'delete';
    content?: string;
    id?: string;
    query?: string;
    color?: string;
    pinned?: boolean;
}

/**
 * メモ操作のツール処理を実行し、結果の JSON 文字列を返します。
 */
export async function executeMemosTool(userId: string, args: MemosToolArgs): Promise<string> {
    switch (args.action) {
        case 'add': {
            if (!args.content) {
                return JSON.stringify({ success: false, error: 'add には content が必須です。' });
            }
            const saved = addMemoToDb(userId, {
                content: args.content,
                color: args.color,
                pinned: args.pinned
            });
            return JSON.stringify({ success: true, action: 'add', id: saved.memo.id, memo: saved.memo });
        }
        case 'search': {
            const memos = searchMemosFromDb(userId, args.query);
            return JSON.stringify({
                success: true,
                message: formatMemoSearchResults(memos)
            });
        }
        case 'update': {
            if (!args.id) {
                return JSON.stringify({ success: false, error: 'update には id が必須です。' });
            }
            const saved = updateMemoInDb(userId, args.id, {
                content: args.content,
                color: args.color,
                pinned: args.pinned
            });
            return JSON.stringify({ success: true, action: 'update', id: args.id, memo: saved.memo });
        }
        case 'delete': {
            if (!args.id) {
                return JSON.stringify({ success: false, error: 'delete には id が必須です。' });
            }
            deleteMemoFromDb(userId, args.id);
            return JSON.stringify({ success: true, action: 'delete', id: args.id });
        }
        default:
            return JSON.stringify({ success: false, error: `不明な action: ${(args as any).action}` });
    }
}

/**
 * タスク操作のツール処理を実行し、結果の JSON 文字列を返します。
 */
export async function executeTasksTool(userId: string, args: TasksToolArgs): Promise<string> {
    switch (args.action) {
        case 'add': {
            if (!args.title) {
                return JSON.stringify({ success: false, error: 'add には title が必須です。' });
            }
            const saved = addTaskToDb(userId, {
                title: args.title,
                priority: args.priority,
                categoryId: args.categoryId,
                scheduledAt: args.scheduledAt || undefined
            });
            return JSON.stringify({
                success: true,
                action: 'add',
                id: saved.task.id,
                task: saved.task
            });
        }
        case 'search': {
            const tasks = searchTasksFromDb(userId, args.query, args.date, args.completed);
            return JSON.stringify({
                success: true,
                message: formatTaskSearchResults(tasks)
            });
        }
        case 'update': {
            if (!args.id) {
                return JSON.stringify({ success: false, error: 'update には id が必須です。' });
            }
            const saved = updateTaskInDb(userId, args.id, {
                title: args.title,
                priority: args.priority,
                categoryId: args.categoryId,
                scheduledAt: args.scheduledAt,
                completed: args.completed
            });
            return JSON.stringify({
                success: true,
                action: 'update',
                id: args.id,
                task: saved.task
            });
        }
        case 'delete': {
            if (!args.id) {
                return JSON.stringify({ success: false, error: 'delete には id が必須です。' });
            }
            deleteTaskFromDb(userId, args.id);
            return JSON.stringify({
                success: true,
                action: 'delete',
                id: args.id
            });
        }
        default:
            return JSON.stringify({ success: false, error: `不明な action: ${(args as any).action}` });
    }
}
