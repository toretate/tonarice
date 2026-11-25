import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDB } from '../../utils/db';
import { claimCoWorkPairingCode, createCoWorkPairingCode, findCoWorkDesktopOwner } from '../pairing';

vi.mock('../../utils/db', () => ({ getDB: vi.fn() }));
let db: Database.Database;

beforeEach(() => {
    db = new Database(':memory:');
    vi.mocked(getDB).mockReturnValue(db);
});
afterEach(() => db.close());

describe('CoWork pairing', () => {
    it('claimCoWorkPairingCode_コードを一度だけ引き換え発行者のユーザーに紐づける', () => {
        const first = createCoWorkPairingCode('first', 0);
        const second = createCoWorkPairingCode('second', 0);
        const claimed = claimCoWorkPairingCode(first.code, 1);
        expect(claimed?.token).toMatch(/^cowork_/);
        expect(claimCoWorkPairingCode(first.code, 2)).toBeUndefined();
        expect(findCoWorkDesktopOwner(claimed!.token, 2)).toBe('first');
        expect(findCoWorkDesktopOwner(first.code, 2)).toBeUndefined();
        expect(findCoWorkDesktopOwner(claimCoWorkPairingCode(second.code, 2)!.token, 3)).toBe('second');
    });

    it('findCoWorkDesktopOwner_古いコードと期限切れセッションを拒否する', () => {
        const old = createCoWorkPairingCode('owner', 0);
        const current = createCoWorkPairingCode('owner', 1);
        expect(claimCoWorkPairingCode(old.code, 2)).toBeUndefined();
        const { token } = claimCoWorkPairingCode(current.code, 2)!;
        expect(findCoWorkDesktopOwner(token, 12 * 3_600_000 + 2)).toBeUndefined();
        const expired = createCoWorkPairingCode('owner', 5);
        expect(claimCoWorkPairingCode(expired.code, 5 * 60_000 + 5)).toBeUndefined();
    });
});
