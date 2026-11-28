import { defineEventHandler, toWebRequest } from 'h3';
import { getBetterAuth } from '../../../utils/better-auth-runtime';

export default defineEventHandler(async event => {
    const { auth } = await getBetterAuth();
    return auth.handler(toWebRequest(event));
});
