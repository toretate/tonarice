import { describe, expect, it, vi } from 'vitest';
import { claimCliLogin, completeCliLogin, startCliLogin } from '../utils/cli-login';

describe('CLIログイン連携', () => {
    it('claimCliLogin_検証値が一致する要求のみ一度だけ受け取る', () => {
        const { state, verifier } = startCliLogin();
        expect(claimCliLogin(state, verifier)).toEqual({ status: 'pending' });
        expect(claimCliLogin(state, 'x'.repeat(43))).toEqual({ status: 'invalid' });
        expect(completeCliLogin(state, 'secret')).toBe(true);
        expect(completeCliLogin(state, 'replacement')).toBe(false);
        expect(claimCliLogin(state, verifier)).toEqual({ status: 'complete', token: 'secret' });
        expect(claimCliLogin(state, verifier)).toEqual({ status: 'invalid' });
    });

    it('claimCliLogin_期限切れの要求を拒否する', () => {
        vi.useFakeTimers();
        try {
            const { state, verifier } = startCliLogin();
            vi.advanceTimersByTime(300001);
            expect(completeCliLogin(state, 'secret')).toBe(false);
            expect(claimCliLogin(state, verifier)).toEqual({ status: 'invalid' });
        } finally { vi.useRealTimers(); }
    });
});
