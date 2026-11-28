import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authMiddleware from '../middleware/auth';
import { findCoWorkDesktopOwner } from '../cowork/pairing';

vi.mock('../cowork/pairing', () => ({ findCoWorkDesktopOwner: vi.fn() }));
vi.mock('node:fs', async (original) => {
    const fs = await original<typeof import('node:fs')>();
    const isUsersFile = (path: unknown) => typeof path === 'string' && /[/\\]users\.json$/.test(path);
    return {
        ...fs,
        existsSync: (path: Parameters<typeof fs.existsSync>[0]) => isUsersFile(path) || fs.existsSync(path),
        readFileSync: (path: string, encoding: BufferEncoding) => isUsersFile(path)
            ? JSON.stringify({ users: [{ id: 'paired-user', role: 'user', identities: [{ email: 'paired@example.test' }] }] })
            : fs.readFileSync(path, encoding)
    };
});

const { mockGetHeader, mockToWebRequest } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockToWebRequest: vi.fn()
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return {
        ...actual,
        getHeader: mockGetHeader,
        toWebRequest: mockToWebRequest
    };
});

const createEvent = (path = '/api/tts') => ({
    path,
    context: {},
    node: {
        req: {
            socket: {
                remoteAddress: '192.168.10.50'
            }
        }
    }
}) as any;

describe('認証ミドルウェア', () => {
    const originalAllowAuthBypass = process.env.ALLOW_AUTH_BYPASS;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.ALLOW_AUTH_BYPASS;
        mockGetHeader.mockReturnValue(undefined);
        mockToWebRequest.mockReturnValue(new Request('http://localhost/api/tts'));
    });

    afterEach(() => {
        if (originalAllowAuthBypass === undefined) {
            delete process.env.ALLOW_AUTH_BYPASS;
        } else {
            process.env.ALLOW_AUTH_BYPASS = originalAllowAuthBypass;
        }
    });

    it('認証ミドルウェア_ALLOW_AUTH_BYPASSがtrueの場合は認証をバイパスすること', async () => {
        process.env.ALLOW_AUTH_BYPASS = 'true';
        const event = createEvent();

        await expect(authMiddleware(event)).resolves.toBeUndefined();

        expect(event.context.user).toEqual({
            id: 'usr_local_dev_bypass',
            email: 'test-user@gmail.com',
            role: 'user'
        });
    });

    it('認証ミドルウェア_ALLOW_AUTH_BYPASSが未設定で認証情報がない場合は未認証メッセージ付き401を返すこと', async () => {
        await expect(authMiddleware(createEvent())).rejects.toMatchObject({
            statusCode: 401,
            message: 'ログインが必要です。'
        });
    });

    it('認証ミドルウェア_pingは認証バイパス設定にかかわらず許可すること', async () => {
        await expect(authMiddleware(createEvent('/api/ping'))).resolves.toBeUndefined();
    });

    it('認証ミドルウェア_デスクトップセッションを発行済みアカウントのCoWorkに限定する', async () => {
        const token = `cowork_${'a'.repeat(43)}`;
        mockGetHeader.mockReturnValue(`Bearer ${token}`);
        vi.mocked(findCoWorkDesktopOwner).mockReturnValue('paired-user');
        const event = createEvent('/api/cowork/tasks');
        await expect(authMiddleware(event)).resolves.toBeUndefined();
        expect(event.context.user.id).toBe('paired-user');
        expect(findCoWorkDesktopOwner).toHaveBeenCalledWith(token);
        await expect(authMiddleware(createEvent('/api/tasks'))).rejects.toMatchObject({ statusCode: 403 });
        await expect(authMiddleware(createEvent('/api/cowork/pair'))).rejects.toMatchObject({ statusCode: 403 });
        vi.mocked(findCoWorkDesktopOwner).mockReturnValue('deleted-user');
        await expect(authMiddleware(createEvent('/api/cowork'))).rejects.toMatchObject({ statusCode: 401 });
    });

    it.each(['/api/auth/login', '/api/auth/callback', '/api/auth/callback?code=test-code', '/api/auth/electron/login', '/api/auth/electron/token', '/api/cowork/pair/claim'])(
        '認証ミドルウェア_%sは未認証でも許可すること',
        async (path) => {
            await expect(authMiddleware(createEvent(path))).resolves.toBeUndefined();
        }
    );
});
