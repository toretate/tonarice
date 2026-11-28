import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

type CliLoginResult = { status: 'complete'; token: string } | { status: 'failed' };

interface PendingLogin { verifierHash: Buffer; expiresAt: number; confirmationHash: Buffer; confirmed?: boolean; result?: CliLoginResult }
const pending = new Map<string, PendingLogin>();
const ttl = 5 * 60 * 1000;

function prune(now = Date.now()) {
    for (const [state, login] of pending) if (login.expiresAt <= now) pending.delete(state);
}

export function startCliLogin() {
    prune();
    if (pending.size >= 100) throw new Error('ログイン要求が多すぎます。');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const confirmationCode = randomBytes(6).toString('base64url');
    pending.set(state, {
        verifierHash: createHash('sha256').update(verifier).digest(),
        confirmationHash: createHash('sha256').update(confirmationCode).digest(),
        expiresAt: Date.now() + ttl
    });
    return { state, verifier, confirmationCode, expiresIn: ttl / 1000 };
}

export function confirmCliLogin(state: string, code: unknown): boolean {
    prune();
    const login = pending.get(state);
    if (!login || login.confirmed || typeof code !== 'string' || !/^[A-Za-z0-9_-]{8}$/.test(code)) return false;
    if (!timingSafeEqual(login.confirmationHash, createHash('sha256').update(code).digest())) return false;
    login.confirmed = true;
    return true;
}

export function completeCliLogin(state: unknown, token: string): boolean {
    return settleCliLogin(state, { status: 'complete', token });
}

export function failCliLogin(state: unknown): boolean {
    return settleCliLogin(state, { status: 'failed' });
}

function settleCliLogin(state: unknown, result: CliLoginResult): boolean {
    prune();
    if (typeof state !== 'string') return false;
    const login = pending.get(state);
    if (!login?.confirmed || login.result) return false;
    login.result = result;
    return true;
}

export function claimCliLogin(state: unknown, verifier: unknown): { status: 'pending' | 'invalid' } | CliLoginResult {
    prune();
    if (typeof state !== 'string' || typeof verifier !== 'string' || state.length !== 43 || verifier.length !== 43) return { status: 'invalid' };
    const login = pending.get(state);
    if (!login || !timingSafeEqual(login.verifierHash, createHash('sha256').update(verifier).digest())) return { status: 'invalid' };
    if (!login.result) return { status: 'pending' };
    pending.delete(state);
    return login.result;
}
