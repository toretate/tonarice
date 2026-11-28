import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export const MASCOT_DATA_FILES = ['identity.md', 'soul.md', 'agents.md', 'user.md', 'memory.md', 'pulse.json'] as const;
export type MascotDataFile = typeof MASCOT_DATA_FILES[number];
export type MascotFiles = Partial<Record<MascotDataFile, string>>;

const selectJournal = (directory: string) => join(directory, '.mascot-memory-journal.json');

function atomicWrite(path: string, value: string) {
    const temporary = path + '.memory.tmp';
    writeFileSync(temporary, value, { encoding: 'utf8', flush: true });
    const delay = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 1; ; attempt++) {
        try {
            renameSync(temporary, path);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
            // ウイルス対策ソフト等による一時ロックを待ち、ジャーナルの原子的な切り替えを守る。
            Atomics.wait(delay, 0, 0, 50);
        }
    }
}

function recover(directory: string) {
    const journalPath = selectJournal(directory);
    if (!existsSync(journalPath)) return;
    const committed = JSON.parse(readFileSync(journalPath, 'utf8')) as MascotFiles;
    for (const name of MASCOT_DATA_FILES) {
        if (typeof committed[name] === 'string') atomicWrite(join(directory, name), committed[name]);
    }
    unlinkSync(journalPath);
}

/** 書き込みの前に更新内容を記録し、途中終了時は次のアクセスで確定を再開する。 */
export function useMascotFiles<T>(
    directory: string,
    action: (files: MascotFiles, commit: (next: MascotFiles) => void) => T
): T {
    const db = new Database(join(directory, '.mascot-memory-lock.db'), { timeout: 1000 });
    try {
        return db.transaction(() => {
            recover(directory);
            const files: MascotFiles = {};
            for (const name of MASCOT_DATA_FILES) {
                const path = join(directory, name);
                if (existsSync(path)) files[name] = readFileSync(path, 'utf8');
            }
            return action(files, next => {
                if (!Object.keys(next).length) return;
                atomicWrite(selectJournal(directory), JSON.stringify(next));
                recover(directory);
            });
        }).immediate();
    } finally { db.close(); }
}
