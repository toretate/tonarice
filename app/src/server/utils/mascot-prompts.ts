import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_ROOT, USERS_DIR } from './paths';
import { safeWriteFileSync } from './fs-helpers';

export const MASCOT_PROMPT_NAMES = ['identity', 'soul', 'user', 'agents', 'memory'] as const;
export type MascotPromptName = typeof MASCOT_PROMPT_NAMES[number];
export type MascotPrompts = Record<MascotPromptName, string>;

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/;
export const MAX_PROMPT_LENGTH = 50000;

function isPathInside(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedBase, resolvedTarget);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 指定ユーザーが対象マスコットを所有しているか（ユーザー別ディレクトリに mascot_config.json が存在するか）検証する。
 */
export function isOwnedMascot(userId: string, mascotId: string): boolean {
    if (!userId || !VALID_ID_PATTERN.test(mascotId)) return false;
    const userMascotsRoot = path.join(USERS_DIR, userId, 'mascots');
    const mascotDir = path.join(userMascotsRoot, mascotId);
    if (!isPathInside(userMascotsRoot, mascotDir)) return false;
    return fs.existsSync(path.join(mascotDir, 'mascot_config.json'));
}

/**
 * 認証済みユーザーが所有するマスコットの OpenClaw プロンプトを読み込む。
 * 所有していない場合は null を返す。
 * ユーザー別保存先（USERS_DIR/<userId>/mascots/<mascotId>/*.md）を優先し、
 * 単一ローカル開発ユーザー向けの未移行データ互換が明示許可された場合のみ APP_ROOT/mascots/<mascotId>/*.md へフォールバックする。
 */
export function readUserMascotPrompts(
    userId: string,
    mascotId: string,
    options?: { allowLegacyLocalFallback?: boolean }
): { prompts: MascotPrompts; configured: boolean } | null {
    if (!isOwnedMascot(userId, mascotId)) {
        return null;
    }

    const userDir = path.join(USERS_DIR, userId, 'mascots', mascotId);
    const legacyDir = path.join(APP_ROOT, 'mascots', mascotId);
    const allowLegacyFallback = options?.allowLegacyLocalFallback === true;

    const prompts: MascotPrompts = {
        identity: '',
        soul: '',
        user: '',
        agents: '',
        memory: ''
    };

    let configured = false;
    for (const name of MASCOT_PROMPT_NAMES) {
        const userFile = path.join(userDir, `${name}.md`);
        if (fs.existsSync(userFile)) {
            configured = true;
            prompts[name] = fs.readFileSync(userFile, 'utf8');
            continue;
        }
        if (allowLegacyFallback) {
            const legacyFile = path.join(legacyDir, `${name}.md`);
            if (isPathInside(path.join(APP_ROOT, 'mascots'), legacyFile) && fs.existsSync(legacyFile)) {
                configured = true;
                prompts[name] = fs.readFileSync(legacyFile, 'utf8');
            }
        }
    }

    return { prompts, configured };
}

/**
 * 認証済みユーザーが所有するマスコットの OpenClaw プロンプトをユーザー別保存先へ保存する。
 * 所有していない場合は null を返す。
 */
export function writeUserMascotPrompts(
    userId: string,
    mascotId: string,
    prompts: Partial<Record<MascotPromptName, string>>
): MascotPrompts | null {
    if (!isOwnedMascot(userId, mascotId)) {
        return null;
    }

    const userDir = path.join(USERS_DIR, userId, 'mascots', mascotId);
    const saved: MascotPrompts = {
        identity: '',
        soul: '',
        user: '',
        agents: '',
        memory: ''
    };

    for (const name of MASCOT_PROMPT_NAMES) {
        const value = typeof prompts[name] === 'string' ? prompts[name] : '';
        saved[name] = value;
        safeWriteFileSync(path.join(userDir, `${name}.md`), value);
    }

    return saved;
}
