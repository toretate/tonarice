import { defineEventHandler, getQuery } from 'h3';

export default defineEventHandler(event => {
    const success = getQuery(event).status === 'success';
    const title = success ? 'Google 認証が完了しました' : 'ログインを完了できませんでした';
    const instruction = success
        ? 'このタブを閉じて、tonarice の CLI に戻ってください。'
        : 'tonarice の CLI に戻り、/login からやり直してください。';

    return new Response(`<!doctype html>
<html lang="ja">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} - tonarice</title>
    <main>
        <h1>${title}</h1>
        <p>${instruction}</p>
    </main>
</html>`, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'content-security-policy': "default-src 'none'; frame-ancestors 'none'"
        }
    });
});
