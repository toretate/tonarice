import { defineEventHandler, toWebRequest } from 'h3';
import { isAuthBypassAllowed } from '../../utils/auth-bypass';
import { getBetterAuth } from '../../utils/better-auth-runtime';
import { disconnectSession } from '../../utils/user-connections';

export default defineEventHandler(async event => {
    if (isAuthBypassAllowed()) return { success: true };
    const { auth } = await getBetterAuth();
    const headers = toWebRequest(event).headers;
    const current = await auth.api.getSession({ headers, query: { disableRefresh: true } });
    const response = await auth.api.signOut({ headers, asResponse: true });
    if (response.ok && current) disconnectSession(current.session.id);
    return response;
});
