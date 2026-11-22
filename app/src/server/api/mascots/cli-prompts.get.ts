import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_ROOT } from '../../utils/paths';

export default defineEventHandler(event => {
    if (!event.context.user?.id) throw createError({ statusCode: 401 });
    const { mascotId } = getQuery(event);
    if (typeof mascotId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(mascotId)) throw createError({ statusCode: 400 });
    const dir = path.join(APP_ROOT, 'mascots', mascotId);
    const prompts: Record<string, string> = {};
    for (const name of ['identity', 'soul', 'user', 'agents', 'memory']) {
        const file = path.join(dir, `${name}.md`);
        prompts[name] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    }
    setHeader(event, 'Cache-Control', 'no-store');
    return { success: true, prompts };
});
