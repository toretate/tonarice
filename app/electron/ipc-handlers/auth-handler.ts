import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';

function resolveAuthOrigin(host: string, port: number): URL {
    const origin = new URL(host.includes('://') ? host : `http://${host}`);
    if (!origin.port && !host.includes('://')) origin.port = String(port);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) {
        throw new Error('Electron の認証には HTTPS またはローカル接続が必要です。');
    }
    if (origin.username || origin.password) throw new Error('接続先の設定が無効です。');
    return origin;
}

export function registerAuthHandlers(getConfig: () => { serverHost?: string; serverPort?: number }) {
    const pending = new Set<number>();
    ipcMain.on('auth:login', async ({ sender }) => {
        const senderId = sender.id;
        if (pending.has(senderId)) return;
        pending.add(senderId);

        try {
            const config = getConfig();
            const origin = resolveAuthOrigin(config.serverHost || 'localhost', config.serverPort || 3000);
            const post = async (pathname: string, body: object) => {
                const response = await fetch(new URL(pathname, origin), {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                    redirect: 'error',
                    signal: AbortSignal.timeout(5000)
                });
                if (!response.ok) throw new Error('ログイン要求に失敗しました。');
                return response.json();
            };
            const { state, verifier, confirmationCode } = await post('/api/auth/cli/start', {});
            if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(verifier) ||
                !/^[A-Za-z0-9_-]{8}$/.test(confirmationCode) || sender.isDestroyed()) return;
            const window = BrowserWindow.fromWebContents(sender);
            if (!window) return;
            const choice = await dialog.showMessageBox(window, {
                type: 'info',
                buttons: ['ブラウザーを開く', 'キャンセル'],
                cancelId: 1,
                message: `確認コード: ${confirmationCode}`,
                detail: 'ブラウザーの確認画面にこのコードを入力してください。'
            });
            if (choice.response !== 0) return;
            const loginURL = new URL('/api/auth/login', origin);
            loginURL.searchParams.set('cli_state', state);
            await shell.openExternal(loginURL.href);

            const deadline = Date.now() + 5 * 60 * 1000;
            while (!sender.isDestroyed() && Date.now() < deadline) {
                await delay(1500);
                const result = await post('/api/auth/cli/claim', { state, verifier });
                if (result.status !== 'complete') continue;
                if (sender.isDestroyed()) return;

                const secure = origin.protocol === 'https:';
                await sender.session.cookies.set({
                    url: origin.origin,
                    name: `${secure ? '__Secure-' : ''}better-auth.session_token`,
                    value: result.token,
                    httpOnly: true,
                    secure,
                    sameSite: 'lax',
                    path: '/',
                    expirationDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
                });
                if (!sender.isDestroyed()) sender.reload();
                return;
            }
        } catch {
            console.warn('[Auth] Electron のログインが完了しませんでした。');
        } finally {
            pending.delete(senderId);
        }
    });
}
