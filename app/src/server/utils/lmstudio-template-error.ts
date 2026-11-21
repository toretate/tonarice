/** LM Studio のテンプレートエラーだけを、応答本文を外部に出さずに判定する。 */
export function isLmStudioTemplateError(error: unknown): boolean {
    const pending: unknown[] = [error];
    const seen = new Set<object>();
    while (pending.length && seen.size < 32) {
        const current = pending.shift();
        if (typeof current === 'string') {
            if (/error rendering prompt with jinja template|jinja[^\n]{0,200}(?:error|undefined|unknown)|(?:error|undefined|unknown)[^\n]{0,200}jinja|unknown test: sequence/i.test(current)) return true;
            continue;
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        const value = current as Record<string, unknown>;
        pending.push(value.message, value.responseBody, value.cause, value.lastError);
        if (Array.isArray(value.errors)) pending.push(...value.errors.slice(0, 10));
    }
    return false;
}

export const LMSTUDIO_TEMPLATE_ERROR_MESSAGE = 'LM Studioのチャットテンプレートでエラーが発生しました。Chat AI設定でこのモデルのツール使用を無効にするか、テンプレート修正の案内を確認してください。';
