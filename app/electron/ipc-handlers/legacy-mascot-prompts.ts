import * as fs from 'node:fs';
import * as path from 'node:path';

export const LEGACY_PROMPT_NAMES = ['identity', 'soul', 'user', 'agents', 'memory'] as const;
export type LegacyPromptName = typeof LEGACY_PROMPT_NAMES[number];

export interface LegacyMascotPromptsPreview {
    found: boolean;
    prompts: Partial<Record<LegacyPromptName, string>>;
}

const VALID_MASCOT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/;

function isPathInside(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedBase, resolvedTarget);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 旧保存先（<baseDir>/mascots/<mascotId>/*.md）を読み取り専用で参照する。
 * ディレクトリやファイルの作成・テンプレート初期化は一切行わない。
 */
export function readLegacyMascotPromptsReadOnly(
    baseDir: string,
    mascotId: string
): LegacyMascotPromptsPreview {
    if (typeof mascotId !== 'string' || !VALID_MASCOT_ID_PATTERN.test(mascotId)) {
        return { found: false, prompts: {} };
    }

    const mascotsRoot = path.join(baseDir, 'mascots');
    const mascotDir = path.join(mascotsRoot, mascotId);
    if (!isPathInside(mascotsRoot, mascotDir) || !fs.existsSync(mascotDir)) {
        return { found: false, prompts: {} };
    }

    const prompts: Partial<Record<LegacyPromptName, string>> = {};
    let found = false;

    for (const name of LEGACY_PROMPT_NAMES) {
        const filePath = path.join(mascotDir, `${name}.md`);
        if (!isPathInside(mascotDir, filePath) || !fs.existsSync(filePath)) {
            continue;
        }
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            continue;
        }
        prompts[name] = fs.readFileSync(filePath, 'utf8');
        found = true;
    }

    return { found, prompts };
}
