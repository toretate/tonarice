import * as fs from 'fs';
import * as path from 'path';
import { USERS_DIR } from './paths';
import { safeWriteFileSync } from './fs-helpers';

function getUserTasksPath(userId: string): string {
    return path.join(USERS_DIR, userId, 'tasks.json');
}

export interface TaskData {
    title: string;
    priority?: 'normal' | 'star' | 'thunder';
    categoryId?: string;
    scheduledAt?: string;
}

/**
 * サーバー側でタスクを生成し、ユーザーの tasks.json に追加・保存します。
 */
export function addTaskToDb(userId: string, payload: TaskData) {
    const tasksPath = getUserTasksPath(userId);
    const userDir = path.dirname(tasksPath);

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    let data = {
        categories: [
            { id: 'default', name: 'Work', order: 0 },
            { id: 'private', name: 'Private', order: 1 }
        ],
        tasks: [] as any[],
        enableNotification: true,
        notificationMinutes: 5
    };

    if (fs.existsSync(tasksPath)) {
        try {
            const raw = fs.readFileSync(tasksPath, 'utf8');
            data = { ...data, ...JSON.parse(raw) };
        } catch (e) {
            console.error('[TasksDB] Failed to read tasks.json:', e);
        }
    }

    // カテゴリIDの解決
    let categoryId = payload.categoryId || 'default';
    const lowerCat = categoryId.toLowerCase();
    const matchedCat = data.categories.find(c => c.id.toLowerCase() === lowerCat || c.name.toLowerCase() === lowerCat);
    if (matchedCat) {
        categoryId = matchedCat.id;
    } else {
        // カテゴリがなければ新規作成
        const newCatId = 'cat_' + Math.random().toString(36).substring(2, 11);
        const order = data.categories.length;
        data.categories.push({ id: newCatId, name: payload.categoryId || 'Work', order });
        categoryId = newCatId;
    }

    // 新しいタスクのオブジェクトを作成 (サーバー側で一意の ID や日時を付与)
    const newTask = {
        id: 'task_' + Math.random().toString(36).substring(2, 11),
        categoryId,
        title: payload.title,
        completed: false,
        priority: payload.priority || 'normal',
        steps: [],
        order: data.tasks.filter(t => t.categoryId === categoryId).length,
        createdAt: new Date().toISOString(),
        status: 'todo',
        scheduledAt: payload.scheduledAt,
        notified: false
    };

    data.tasks.push(newTask);

    safeWriteFileSync(tasksPath, JSON.stringify(data, null, 4));

    return {
        categories: data.categories,
        task: newTask
    };
}
