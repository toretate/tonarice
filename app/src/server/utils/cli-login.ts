import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

interface PendingLogin { verifierHash: Buffer; expiresAt: number; token?: string }
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
    pending.set(state, { verifierHash: createHash('sha256').update(verifier).digest(), expiresAt: Date.now() + ttl });
    return { state, verifier, expiresIn: ttl / 1000 };
}

export function completeCliLogin(state: unknown, token: string): boolean {
    prune();
    if (typeof state !== 'string') return false;
    const login = pending.get(state);
    if (!login || login.token) return false;
    login.token = token;
    return true;
}

export function claimCliLogin(state: unknown, verifier: unknown): { status: 'pending' | 'invalid' } | { status: 'complete'; token: string } {
    prune();
    if (typeof state !== 'string' || typeof verifier !== 'string' || state.length !== 43 || verifier.length !== 43) return { status: 'invalid' };
    const login = pending.get(state);
    if (!login || !timingSafeEqual(login.verifierHash, createHash('sha256').update(verifier).digest())) return { status: 'invalid' };
    if (!login.token) return { status: 'pending' };
    pending.delete(state);
    return { status: 'complete', token: login.token };
}
