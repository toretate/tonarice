import { createError, defineEventHandler, getQuery } from 'h3';
import { electronAuthCompletion } from '../../../../utils/electron-auth-protocol';
import { getBetterAuth } from '../../../utils/better-auth-runtime';
import { redirectToGoogle } from '../../../utils/better-auth-login';

export default defineEventHandler(async event => {
    const { client_id, state, code_challenge } = getQuery(event);
    if (client_id !== 'electron' ||
        typeof state !== 'string' || !/^[A-Za-z0-9]{16}$/.test(state) ||
        typeof code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code_challenge)) {
        throw createError({ statusCode: 400, message: 'Electron のログイン要求が無効です。' });
    }

    const { auth } = await getBetterAuth();
    const origin = new URL(auth.options.baseURL as string).origin;
    const response = await auth.api.signInSocial({
        body: { provider: 'google', callbackURL: electronAuthCompletion, errorCallbackURL: electronAuthCompletion },
        query: { client_id, state, code_challenge },
        headers: new Headers({ origin }),
        asResponse: true
    });
    return redirectToGoogle(response, 302);
});
