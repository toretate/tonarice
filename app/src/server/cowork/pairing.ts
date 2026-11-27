import { createHash, randomBytes } from 'node:crypto';
import { getDB } from '../utils/db';

const codeAge = 5 * 60_000;
const sessionAge = 12 * 3_600_000;
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const makeSecret = () => randomBytes(32).toString('base64url');
const initialized = new WeakSet<ReturnType<typeof getDB>>();

function getPairingDb() {
    const db = getDB();
    if (initialized.has(db)) return db;
    db.exec(`
        CREATE TABLE IF NOT EXISTS cowork_pairing (
            hash TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cowork_desktop_sessions (
            hash TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
    `);
    initialized.add(db);
    return db;
}

export function createCoWorkPairingCode(owner: string, now = Date.now()) {
    const db = getPairingDb();
    const code = makeSecret();
    db.transaction(() => {
        db.prepare('DELETE FROM cowork_pairing WHERE expires_at <= ? OR owner = ?').run(now, owner);
        db.prepare('INSERT INTO cowork_pairing VALUES (?, ?, ?)').run(hash(code), owner, now + codeAge);
    }).immediate();
    return { code, expiresIn: codeAge / 1_000 };
}

export function claimCoWorkPairingCode(code: string, now = Date.now()) {
    const db = getPairingDb();
    return db.transaction(() => {
        const pending = db.prepare<[string, number], { owner: string }>(`
            DELETE FROM cowork_pairing WHERE hash = ? AND expires_at > ? RETURNING owner
        `).get(hash(code), now);
        if (!pending) return undefined;
        const token = `cowork_${makeSecret()}`;
        db.prepare('DELETE FROM cowork_desktop_sessions WHERE expires_at <= ?').run(now);
        db.prepare('INSERT INTO cowork_desktop_sessions VALUES (?, ?, ?)').run(hash(token), pending.owner, now + sessionAge);
        return { token };
    }).immediate();
}

export function findCoWorkDesktopOwner(token: string, now = Date.now()) {
    if (!/^cowork_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return getPairingDb().prepare<[string, number], { owner: string }>(`
        SELECT owner FROM cowork_desktop_sessions WHERE hash = ? AND expires_at > ?
    `).get(hash(token), now)?.owner;
}
