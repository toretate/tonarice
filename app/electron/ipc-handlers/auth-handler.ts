import { app, BrowserWindow, ipcMain } from 'electron';
import { resolve } from 'node:path';
import { electronClient } from '@better-auth/electron/client';
import { createAuthClient } from 'better-auth/client';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { electronAuthScheme, electronAuthStartPath } from '../../src/utils/electron-auth-protocol';

export function registerAuthHandlers(baseURL: string) {
    const origin = new URL(baseURL);
    let loginWindow: BrowserWindow | null = null;
    const storage: Record<string, unknown> = {};
    const getWindow = () => loginWindow && !loginWindow.isDestroyed() ? loginWindow : null;
    const client = createAuthClient({
        baseURL: origin.origin,
        fetchOptions: {
            onSuccess: async ({ request, response }) => {
                if (new URL(request.url).pathname !== '/api/auth/electron/token') return;
                const window = getWindow();
                if (!window) return;

                const secure = origin.protocol === 'https:';
                const name = `${secure ? '__Secure-' : ''}better-auth.session_token`;
                const cookie = parseSetCookieHeader(response.headers.get('set-cookie') ?? '').get(name);
                const maxAge = Number(cookie?.['max-age']);
                if (!cookie?.value || !Number.isFinite(maxAge) || maxAge <= 0) {
                    throw new Error('Electron の認証セッションを受け取れませんでした。');
                }

                // 既存の HTTP、画像、WebSocket が利用する Chromium セッションに反映する。
                await window.webContents.session.cookies.set({
                    url: origin.origin,
                    name,
                    value: cookie.value,
                    httpOnly: true,
                    secure,
                    sameSite: 'lax',
                    path: '/',
                    expirationDate: Date.now() / 1000 + maxAge
                });
                if (!window.isDestroyed()) {
                    window.show();
                    window.focus();
                    window.webContents.reload();
                }
            }
        },
        plugins: [electronClient({
            protocol: electronAuthScheme,
            signInURL: new URL(electronAuthStartPath, origin).href,
            userImageProxy: { enabled: false },
            disableCache: true,
            // 永続化は Chromium の Cookie に任せる。
            storage: {
                getItem: key => storage[key] ?? null,
                setItem: (key, value) => { storage[key] = value; }
            }
        })]
    });

    // 音楽用の Chromium プロトコルとは別に、OS からのディープリンクを受け取る。
    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return;
    }
    const registered = process.defaultApp && process.argv[1]
        ? app.setAsDefaultProtocolClient(electronAuthScheme, process.execPath, [resolve(process.argv[1])])
        : app.setAsDefaultProtocolClient(electronAuthScheme);
    if (!registered) console.warn('[Auth] Electron のディープリンクを登録できませんでした。');

    const completeLogin = async (value: string) => {
        const target = URL.parse(value);
        if (!getWindow() || target?.protocol !== `${electronAuthScheme}:` ||
            target.hostname !== 'auth' || target.pathname !== '/callback' ||
            target.username || target.password || target.port || target.search ||
            !/^#token=[A-Za-z0-9_=%-]+$/.test(target.hash)) return;

        try {
            await client.authenticate({ token: target.hash.slice(7), fetchOptions: { throw: true } });
        } catch {
            console.warn('[Auth] Electron のログインを完了できませんでした。');
        }
    };
    app.on('second-instance', (_event, argv) => {
        const link = argv.find(arg => arg.startsWith(`${electronAuthScheme}://`));
        if (link) void completeLogin(link);
    });
    app.on('open-url', (event, url) => {
        if (!url.startsWith(`${electronAuthScheme}://`)) return;
        event.preventDefault();
        void completeLogin(url);
    });
    ipcMain.on('auth:login', async ({ sender }) => {
        try {
            if (sender.isDestroyed() || new URL(sender.getURL()).origin !== origin.origin) return;
            loginWindow = BrowserWindow.fromWebContents(sender);
            if (loginWindow) await client.requestAuth();
        } catch {
            console.warn('[Auth] Electron のログインを開始できませんでした。');
        }
    });
}
