import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { APP_ROOT, USERS_DIR } from './paths';
import { useMascotFiles, type MascotFiles } from './mascot-file-transaction';
import { reconcileManualPromptSave } from '../mastra/companion-state';

export const MASCOT_PROMPT_NAMES = ['identity', 'soul', 'user', 'agents', 'memory'] as const;
const EXPLICIT_CONFIG_MARKER_NAMES = ['identity', 'soul', 'user', 'agents'] as const;
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
 * configured は memory.md 単独では true にせず、従来の全項目明示保存（memory 以外のファイル存在）で判定する。
 */
export function readUserMascotPrompts(
    userId: string,
    mascotId: string,
    options?: { allowLegacyLocalFallback?: boolean }
) {
    if (!isOwnedMascot(userId, mascotId)) {
        return null;
    }

    const userDir = path.join(USERS_DIR, userId, 'mascots', mascotId);
    const legacyDir = path.join(APP_ROOT, 'mascots', mascotId);
    const allowLegacyFallback = options?.allowLegacyLocalFallback === true;
    const files = useMascotFiles(userDir, value => value);
    return resolveMascotPrompts(files, legacyDir, allowLegacyFallback);
}

function resolveMascotPrompts(files: MascotFiles, legacyDir: string, allowLegacyFallback: boolean) {
    const prompts: MascotPrompts = {
        identity: '',
        soul: '',
        user: '',
        agents: '',
        memory: ''
    };

    let configured = false;
    for (const name of MASCOT_PROMPT_NAMES) {
        const isMarker = (EXPLICIT_CONFIG_MARKER_NAMES as readonly string[]).includes(name);
        const content = files[`${name}.md`];
        if (content !== undefined) {
            if (isMarker) configured = true;
            prompts[name] = content;
            continue;
        }
        if (allowLegacyFallback) {
            const legacyFile = path.join(legacyDir, `${name}.md`);
            if (isPathInside(path.join(APP_ROOT, 'mascots'), legacyFile) && fs.existsSync(legacyFile)) {
                if (isMarker) configured = true;
                prompts[name] = fs.readFileSync(legacyFile, 'utf8');
            }
        }
    }

    const revision = createHash('sha256').update(JSON.stringify(prompts)).digest('hex');
    return { prompts, configured, revision };
}

/**
 * 認証済みユーザーが所有するマスコットの OpenClaw プロンプト全項目をユーザー別保存先へ保存する。
 * 所有していない場合は null を返す。
 */
export class MascotPromptConflict extends Error {}

export function writeUserMascotPrompts(
    userId: string,
    mascotId: string,
    prompts: Partial<Record<MascotPromptName, string>>,
    options?: { expectedRevision?: string; allowLegacyLocalFallback?: boolean }
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

    useMascotFiles(userDir, (files, commit) => {
        if (options?.expectedRevision && resolveMascotPrompts(
            files, path.join(APP_ROOT, 'mascots', mascotId), options.allowLegacyLocalFallback === true
        ).revision !== options.expectedRevision) throw new MascotPromptConflict();
        const next: MascotFiles = {};
        for (const name of MASCOT_PROMPT_NAMES) {
            const value = typeof prompts[name] === 'string' ? prompts[name] : '';
            saved[name] = value;
            next[`${name}.md`] = value;
        }
        commit(reconcileManualPromptSave(files, next));
    });

    return saved;
}

export type WriteMemoryResult =
    | { status: 'not_found' }
    | { status: 'conflict'; prompts: MascotPrompts; configured: boolean }
    | { status: 'saved'; memory: string; prompts: MascotPrompts; configured: boolean };

/**
 * 長期記憶（memory.md）のみをユーザー別保存先へ保存する。
 * 他のプロンプトファイルには触れず、expectedCurrentMemory が現在値と異なる場合は競合として上書きしない。
 */
export function writeUserMascotMemory(
    userId: string,
    mascotId: string,
    memory: string,
    options?: { expectedCurrentMemory?: string; allowLegacyLocalFallback?: boolean }
): WriteMemoryResult {
    if (!isOwnedMascot(userId, mascotId)) {
        return { status: 'not_found' };
    }

    const userDir = path.join(USERS_DIR, userId, 'mascots', mascotId);
    return useMascotFiles(userDir, (files, commit) => {
        const current = resolveMascotPrompts(files, path.join(APP_ROOT, 'mascots', mascotId), options?.allowLegacyLocalFallback === true);
        if (options?.expectedCurrentMemory !== undefined && current.prompts.memory !== options.expectedCurrentMemory) {
            return { status: 'conflict', ...current };
        }
        commit(reconcileManualPromptSave(files, { 'memory.md': memory }));
        return { status: 'saved', memory, ...current, prompts: { ...current.prompts, memory } };
    });
}
