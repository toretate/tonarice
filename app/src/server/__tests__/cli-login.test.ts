import { describe, expect, it, vi } from 'vitest';
import { claimCliLogin, completeCliLogin, confirmCliLogin, startCliLogin } from '../utils/cli-login';

describe('CLIログイン連携', () => {
    it('claimCliLogin_検証値が一致する要求のみ一度だけ受け取る', () => {
        const { state, verifier, confirmationCode } = startCliLogin();
        expect(claimCliLogin(state, verifier)).toEqual({ status: 'pending' });
        expect(claimCliLogin(state, 'x'.repeat(43))).toEqual({ status: 'invalid' });
        expect(completeCliLogin(state, 'secret')).toBe(false);
        expect(confirmCliLogin(state, 'bad-code')).toBe(false);
        expect(confirmCliLogin(state, confirmationCode)).toBe(true);
        expect(confirmCliLogin(state, confirmationCode)).toBe(false);
        expect(completeCliLogin(state, 'secret')).toBe(true);
        expect(completeCliLogin(state, 'replacement')).toBe(false);
        expect(claimCliLogin(state, verifier)).toEqual({ status: 'complete', token: 'secret' });
        expect(claimCliLogin(state, verifier)).toEqual({ status: 'invalid' });
    });

    it('claimCliLogin_期限切れの要求を拒否する', () => {
        vi.useFakeTimers();
        try {
            const { state, verifier, confirmationCode } = startCliLogin();
            expect(confirmCliLogin(state, confirmationCode)).toBe(true);
            vi.advanceTimersByTime(300001);
            expect(completeCliLogin(state, 'secret')).toBe(false);
            expect(claimCliLogin(state, verifier)).toEqual({ status: 'invalid' });
        } finally { vi.useRealTimers(); }
    });
});
