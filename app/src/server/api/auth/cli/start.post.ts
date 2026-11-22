import { createError, defineEventHandler, setHeader } from 'h3';
import { startCliLogin } from '../../../utils/cli-login';

export default defineEventHandler(event => {
    setHeader(event, 'Cache-Control', 'no-store');
    try { return startCliLogin(); }
    catch { throw createError({ statusCode: 429, statusMessage: 'ログイン要求が多すぎます。' }); }
});
