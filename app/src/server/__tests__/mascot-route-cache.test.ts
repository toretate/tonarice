import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mascotRouteHandler, { createFileEtag, isRequestNotModified } from '../routes/mascots/[...path]';

const {
    mockExistsSync,
    mockStatSync,
    mockCreateReadStream,
    mockGetHeader,
    mockToWebRequest,
    mockSetResponseHeader,
    mockSendNoContent,
    mockSendStream,
    mockRequireBetterAuthSession,
    mockUsersDir,
    mockMascotFilePath
} = await vi.hoisted(async () => {
    const nodePath = await import('node:path');
    const usersDir = nodePath.resolve('/storage/users');
    return {
        mockExistsSync: vi.fn(),
        mockStatSync: vi.fn(),
        mockCreateReadStream: vi.fn(),
        mockGetHeader: vi.fn(),
        mockToWebRequest: vi.fn(),
        mockSetResponseHeader: vi.fn(),
        mockSendNoContent: vi.fn(),
        mockSendStream: vi.fn(),
        mockRequireBetterAuthSession: vi.fn(),
        mockUsersDir: usersDir,
        mockMascotFilePath: nodePath.join(usersDir, 'owner', 'mascots', 'mascot_a', 'outfits', 'body.png')
    };
});

vi.mock('fs', () => ({
    default: {
        existsSync: mockExistsSync,
        statSync: mockStatSync,
        createReadStream: mockCreateReadStream
    }
}));

vi.mock('../utils/paths', () => ({
    USERS_DIR: mockUsersDir,
    resolveMascotPath: () => mockMascotFilePath
}));

vi.mock('../utils/better-auth-runtime', () => ({
    requireBetterAuthSession: mockRequireBetterAuthSession
}));

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return {
        ...actual,
        getHeader: mockGetHeader,
        toWebRequest: mockToWebRequest,
        setResponseHeader: mockSetResponseHeader,
        sendNoContent: mockSendNoContent,
        sendStream: mockSendStream
    };
});

const createRemoteEvent = () => ({
    context: { params: { path: 'users/owner/mascot_a/outfits/body.png' } },
    node: { req: { socket: { remoteAddress: '203.0.113.10' } } }
}) as any;

describe('マスコット画像配信キャッシュ', () => {
    const originalAllowAuthBypass = process.env.ALLOW_AUTH_BYPASS;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequireBetterAuthSession.mockRejectedValue({ statusCode: 401 });
        process.env.ALLOW_AUTH_BYPASS = 'false';
        mockToWebRequest.mockReturnValue(new Request('http://localhost/mascots/test'));
        mockExistsSync.mockReturnValue(true);
        mockStatSync.mockReturnValue({
            isDirectory: () => false,
            size: 100,
            mtimeMs: 1000,
            mtime: new Date(1000)
        });
        mockSendNoContent.mockReturnValue({ statusCode: 304 });
    });

    afterAll(() => {
        if (originalAllowAuthBypass === undefined) {
            delete process.env.ALLOW_AUTH_BYPASS;
        } else {
            process.env.ALLOW_AUTH_BYPASS = originalAllowAuthBypass;
        }
    });

    it('createFileEtag_サイズと更新時刻から弱いETagを生成すること', () => {
        expect(createFileEtag(100, 1000)).toBe('W/"64-3e8"');
    });

    it('isRequestNotModified_IfNoneMatchをIfModifiedSinceより優先すること', () => {
        expect(isRequestNotModified('W/"different"', new Date(5000).toUTCString(), 'W/"64-3e8"', 1000)).toBe(false);
        expect(isRequestNotModified('"64-3e8"', undefined, 'W/"64-3e8"', 1000)).toBe(true);
    });

    it('未認証の場合はETagが一致してもstatや304判定より先に401を返すこと', async () => {
        mockGetHeader.mockImplementation((_event, name: string) => {
            if (name === 'host') return 'example.com';
            if (name === 'if-none-match') return 'W/"64-3e8"';
            return undefined;
        });

        await expect(mascotRouteHandler(createRemoteEvent())).rejects.toMatchObject({ statusCode: 401 });
        expect(mockStatSync).not.toHaveBeenCalled();
        expect(mockSendNoContent).not.toHaveBeenCalled();
    });

    it('認証・所有者確認後にETagが一致した場合は304を返すこと', async () => {
        mockGetHeader.mockImplementation((_event, name: string) => {
            if (name === 'host') return 'example.com';
            if (name === 'authorization') return 'Bearer valid-token';
            if (name === 'if-none-match') return 'W/"64-3e8"';
            return undefined;
        });
        mockRequireBetterAuthSession.mockResolvedValue({ user: { id: 'owner' } });

        const result = await mascotRouteHandler(createRemoteEvent());

        expect(result).toEqual({ statusCode: 304 });
        expect(mockRequireBetterAuthSession).toHaveBeenCalledWith(expect.any(Headers));
        expect(mockSendNoContent).toHaveBeenCalledWith(expect.anything(), 304);
        expect(mockSendStream).not.toHaveBeenCalled();
    });
});
