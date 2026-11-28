export type MascotPrompts = Awaited<ReturnType<NonNullable<Window['electronAPI']>['getMascotPrompts']>>;
export type MascotPromptKey = keyof MascotPrompts;
export type LegacyMascotPromptsPreview = {
    found: boolean;
    prompts: Partial<MascotPrompts>;
};

const PROMPT_KEYS: readonly MascotPromptKey[] = ['identity', 'soul', 'user', 'agents', 'memory'];

export async function loadMascotPrompts(mascotId: string): Promise<{ prompts: MascotPrompts; configured: boolean }> {
    const query = new URLSearchParams({ mascotId });
    const response = await fetch('/api/mascots/cli-prompts?' + query, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('サーバーからプロンプトを取得できませんでした。');
    const data = await response.json();
    if (!data?.success || typeof data.configured !== 'boolean' || !data.prompts) {
        throw new Error('プロンプトの応答が不正です。');
    }
    return data;
}

export async function saveMascotPrompts(mascotId: string, prompts: MascotPrompts): Promise<void> {
    const response = await fetch('/api/mascots/cli-prompts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mascotId, prompts })
    });
    if (!response.ok) throw new Error('サーバーにプロンプトを保存できませんでした。');
}

function readLegacyFromLocalStorage(mascotId: string): LegacyMascotPromptsPreview {
    if (typeof localStorage === 'undefined') return { found: false, prompts: {} };
    try {
        const raw = localStorage.getItem(`desktop_ai_mascot_prompts_${mascotId}`);
        if (raw === null) return { found: false, prompts: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { found: false, prompts: {} };
        }
        const prompts: Partial<MascotPrompts> = {};
        let found = false;
        for (const key of PROMPT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(parsed, key) && typeof parsed[key] === 'string') {
                prompts[key] = parsed[key];
                found = true;
            }
        }
        return { found, prompts };
    } catch {
        return { found: false, prompts: {} };
    }
}

/**
 * この端末に存在する旧プロンプト設定を読み取り専用で参照する（ファイル作成・サーバー送信なし）。
 */
export async function previewLocalLegacyMascotPrompts(mascotId: string): Promise<LegacyMascotPromptsPreview> {
    if (typeof window !== 'undefined' && typeof window.electronAPI?.previewLegacyMascotPrompts === 'function') {
        const result = await window.electronAPI.previewLegacyMascotPrompts(mascotId);
        if (!result || typeof result !== 'object') return { found: false, prompts: {} };
        const prompts: Partial<MascotPrompts> = {};
        let found = false;
        for (const key of PROMPT_KEYS) {
            if (result.prompts && Object.prototype.hasOwnProperty.call(result.prompts, key) && typeof result.prompts[key] === 'string') {
                prompts[key] = result.prompts[key];
                found = true;
            }
        }
        return { found: result.found === true && found, prompts };
    }
    return readLegacyFromLocalStorage(mascotId);
}
