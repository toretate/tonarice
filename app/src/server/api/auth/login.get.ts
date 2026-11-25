import { defineEventHandler, sendRedirect, createError, getQuery } from 'h3';
import { resolveGoogleRedirectUri } from '../../utils/auth-redirect-uri';

export default defineEventHandler((event) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = resolveGoogleRedirectUri(event);

    if (!clientId) {
        throw createError({
            statusCode: 500,
            statusMessage: 'サーバーエラー: GOOGLE_CLIENT_ID が設定されていません。'
        });
    }

    const scope = 'openid email profile';
    const state = getQuery(event).cli_state;
    if (state !== undefined && (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state))) throw createError({ statusCode: 400 });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;

    console.log('[Auth] Googleログインへリダイレクトします');
    return sendRedirect(event, authUrl);
});
