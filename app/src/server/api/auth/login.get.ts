import { defineEventHandler, getQuery } from 'h3';
import { beginGoogleLogin, parseLoginState } from '../../utils/better-auth-login';

export default defineEventHandler(event => {
    const state = getQuery(event).cli_state;
    if (state === undefined) return beginGoogleLogin();

    const value = parseLoginState(state);
    return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8">
        <title>tonarice のログイン</title><h1>tonarice のログイン</h1>
        <p>ログインを開始したデスクトップアプリまたは CLI に表示された確認コードを入力してください。</p>
        <form method="post" action="/api/auth/login">
            <input type="hidden" name="state" value="${value}">
            <label>確認コード <input name="confirmationCode" required maxlength="8" autocomplete="off"></label>
            <button type="submit">Google で続行</button>
        </form></html>`, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'"
        }
    });
});
