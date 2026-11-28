import { afterEach, expect, it, vi } from 'vitest';
import { registerAuthHandlers } from '../auth-handler';

const { on, onApp, authenticate, requestAuth, createAuthClient, fromWebContents } = vi.hoisted(() => ({
    on: vi.fn(), onApp: vi.fn(), authenticate: vi.fn(), requestAuth: vi.fn(), createAuthClient: vi.fn(), fromWebContents: vi.fn()
}));
vi.mock('electron', () => ({
    app: { requestSingleInstanceLock: () => true, setAsDefaultProtocolClient: () => true, on: onApp },
    BrowserWindow: { fromWebContents },
    ipcMain: { on }
}));
vi.mock('better-auth/client', () => ({ createAuthClient }));
vi.mock('@better-auth/electron/client', () => ({ electronClient: vi.fn() }));

afterEach(() => vi.resetAllMocks());

it('registerAuthHandlers 同一オリジンから公式認証を開始してCookieを反映する', async () => {
    createAuthClient.mockReturnValue({ authenticate, requestAuth });
    const cookies = { set: vi.fn() };
    const webContents = { session: { cookies }, reload: vi.fn() };
    fromWebContents.mockReturnValue({ webContents, isDestroyed: () => false, show: vi.fn(), focus: vi.fn() });
    registerAuthHandlers('http://localhost:3000');

    expect(onApp).toHaveBeenCalledWith('second-instance', expect.any(Function));
    const [channel, handler] = on.mock.calls[0]!;
    expect(channel).toBe('auth:login');
    const sender = (url: string) => ({ getURL: () => url, isDestroyed: () => false });
    await handler({ sender: sender('https://other.example.test/') });
    expect(requestAuth).not.toHaveBeenCalled();
    await handler({ sender: sender('http://localhost:3000/#settings') });
    expect(requestAuth).toHaveBeenCalledOnce();
    const handleLink = onApp.mock.calls.find(([event]) => event === 'second-instance')![1];
    handleLink({}, ['com.toretate.tonarice://other/callback#token=invalid']);
    expect(authenticate).not.toHaveBeenCalled();
    handleLink({}, ['com.toretate.tonarice://auth/callback#token=test-code']);
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ token: 'test-code' }));

    const { onSuccess } = createAuthClient.mock.calls[0]![0].fetchOptions;
    await onSuccess({
        request: { url: 'http://localhost:3000/api/auth/electron/token' },
        response: new Response(null, {
            headers: { 'set-cookie': 'better-auth.session_token=unit-test; Max-Age=3600; HttpOnly; Path=/' }
        })
    });
    expect(cookies.set).toHaveBeenCalledWith(expect.objectContaining({
        name: 'better-auth.session_token', value: 'unit-test', httpOnly: true
    }));
    expect(webContents.reload).toHaveBeenCalledOnce();
});
