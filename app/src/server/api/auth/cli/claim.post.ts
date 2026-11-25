import { createError, defineEventHandler, readBody, setHeader } from 'h3';
import { claimCliLogin } from '../../../utils/cli-login';

export default defineEventHandler(async event => {
    setHeader(event, 'Cache-Control', 'no-store');
    const body = await readBody(event);
    const result = claimCliLogin(body?.state, body?.verifier);
    if (result.status === 'invalid') throw createError({ statusCode: 400, statusMessage: 'ログイン要求が無効または期限切れです。' });
    return result;
});
