import { createError, defineEventHandler, getQuery, setHeader } from 'h3';
import { isAuthBypassAllowed } from '../../utils/auth-bypass';
import { readUserMascotPrompts } from '../../utils/mascot-prompts';

const LOCAL_DEV_BYPASS_USER_ID = 'usr_local_dev_bypass';

export default defineEventHandler(event => {
    const userId = event.context.user?.id;
    if (!userId) throw createError({ statusCode: 401 });
    const { mascotId } = getQuery(event);
    if (typeof mascotId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(mascotId)) throw createError({ statusCode: 400 });

    const allowLegacyLocalFallback = isAuthBypassAllowed() && userId === LOCAL_DEV_BYPASS_USER_ID;
    const prompts = readUserMascotPrompts(userId, mascotId, { allowLegacyLocalFallback });
    if (!prompts) throw createError({ statusCode: 404 });

    setHeader(event, 'Cache-Control', 'no-store');
    return { success: true, prompts };
});
