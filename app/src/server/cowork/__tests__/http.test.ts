import { createApp, createRouter, eventHandler, getHeader, toWebHandler } from 'h3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import list from '../../api/cowork/index.get';
import create from '../../api/cowork/tasks/index.post';
import update from '../../api/cowork/tasks/[id].patch';
import remove from '../../api/cowork/tasks/[id].delete';
import run from '../../api/cowork/tasks/[id]/run.post';
import importLegacy from '../../api/cowork/import.post';
import pair from '../../api/cowork/pair.post';
import claim from '../../api/cowork/pair/claim.post';
import { getDB } from '../../utils/db';
import { findCoWorkDesktopOwner } from '../pairing';
import { getCoWorkRepository } from '../runtime';
import { CoWorkRepository } from '../repository';

vi.mock('../runtime', () => ({ getCoWorkRepository: vi.fn() }));
vi.mock('../../utils/db', () => ({ getDB: vi.fn() }));
let db: Database.Database;
let handler: ReturnType<typeof toWebHandler>;

const input = {
    name: '確認',
    prompt: '確認してください。',
    schedule: { type: 'daily', intervalDays: 1, time: '09:00' },
    enabled: true,
    timeZone: 'Asia/Tokyo'
};

function request(path: string, method = 'GET', user?: string, body?: unknown, extraHeaders?: Record<string, string>) {
    return handler(new Request(`http://localhost/api/cowork${path}`, {
        method,
        headers: {
            ...(user && { 'x-test-user': user }),
            ...(method !== 'GET' && { 'content-type': 'application/json' }),
            ...extraHeaders
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
}

beforeEach(() => {
    db = new Database(':memory:');
    vi.mocked(getDB).mockReturnValue(db);
    vi.mocked(getCoWorkRepository).mockReturnValue(new CoWorkRepository(db));
    const router = createRouter()
        .get('/api/cowork', list)
        .post('/api/cowork/tasks', create)
        .patch('/api/cowork/tasks/:id', update)
        .delete('/api/cowork/tasks/:id', remove)
        .post('/api/cowork/tasks/:id/run', run)
        .post('/api/cowork/import', importLegacy)
        .post('/api/cowork/pair', pair)
        .post('/api/cowork/pair/claim', claim);

    handler = toWebHandler(createApp()
        .use(eventHandler(event => {
            const user = getHeader(event, 'x-test-user');
            if (user) event.context.user = { id: user, email: `${user}@example.test` };
        }))
        .use(router));
});

afterEach(() => db.close());

describe('CoWork API', () => {
    it('タスク API_認証済み所有者で一覧・更新・実行・削除を制限する', async () => {
        expect((await request('')).status).toBe(401);
        expect((await request('/tasks', 'POST', undefined, input)).status).toBe(401);
        const created = await request('/tasks', 'POST', 'first', { ...input, owner: 'second' });
        expect(created.status).toBe(201);
        const task = await created.json() as { id: string };
        const path = `/tasks/${task.id}`;

        expect(await (await request('', 'GET', 'second')).json()).toMatchObject({ tasks: [], runs: [] });
        expect((await request(path, 'PATCH', 'second', { enabled: false })).status).toBe(404);
        expect((await request(`${path}/run`, 'POST', 'second')).status).toBe(404);
        expect((await request(path, 'DELETE', 'second')).status).toBe(404);
        expect((await request(path, 'PATCH', 'first', { enabled: false })).status).toBe(200);
        expect((await request(`${path}/run`, 'POST', 'first')).status).toBe(202);
        const listed = await request('', 'GET', 'first');
        expect(listed.headers.get('cache-control')).toBe('no-store');
        expect(await listed.json()).toMatchObject({
            tasks: [{ id: task.id, enabled: false }],
            runs: [{ status: 'queued', taskId: task.id }]
        });
        expect((await request(path, 'DELETE', 'first')).status).toBe(204);
    });

    it('接続 API_認証済みアカウントで発行し一度だけ引き換える', async () => {
        expect((await request('/pair', 'POST')).status).toBe(401);
        const issued = await request('/pair', 'POST', 'first');
        expect(issued.status).toBe(200);
        expect(issued.headers.get('cache-control')).toBe('no-store');
        const { code } = await issued.json() as { code: string };
        const claimed = await request('/pair/claim', 'POST', undefined, { code });
        expect(claimed.status).toBe(200);
        expect(claimed.headers.get('cache-control')).toBe('no-store');
        const { token } = await claimed.json() as { token: string };
        expect(findCoWorkDesktopOwner(token)).toBe('first');
        expect((await request('/pair/claim', 'POST', undefined, { code })).status).toBe(401);
    });

    it('入力 API_不正な入力形式とアカウント切替後の取込を拒否する', async () => {
        expect((await request('/tasks', 'POST', 'first', { ...input, timeZone: 'invalid' })).status).toBe(400);
        expect((await request('/tasks', 'POST', 'first', input, { 'content-type': 'text/plain' })).status).toBe(415);
        expect((await request('/tasks', 'POST', 'first', input, { 'content-length': '150000' })).status).toBe(413);
        const { scope } = await (await request('', 'GET', 'first')).json() as { scope: string };
        expect((await request('/import', 'POST', 'second', { tasks: [], runs: [] }, { 'x-cowork-scope': scope })).status).toBe(409);
    });
});
