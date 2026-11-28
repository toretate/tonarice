import { defineEventHandler, getHeader, readBody } from 'h3';
import { beginGoogleLogin, parseLoginState } from '../../utils/better-auth-login';

export default defineEventHandler(async event => {
    const body = await readBody(event);
    return beginGoogleLogin(parseLoginState(body?.state), getHeader(event, 'origin'), body?.confirmationCode);
});
