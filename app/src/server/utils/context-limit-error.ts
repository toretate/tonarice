/** 入れ子のAPIエラーを判定し、本文そのものは画面へ返さない。 */
export function isContextLimitError(error: unknown): boolean {
    const pending: unknown[] = [error];
    const seen = new Set<object>();
    while (pending.length && seen.size < 32) {
        const current = pending.shift();
        if (typeof current === 'string') {
            if (/context_length_exceeded|context (?:size|length|exceeded)|maximum context/i.test(current)) return true;
            continue;
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        const value = current as Record<string, unknown>;
        pending.push(value.message, value.code, value.responseBody, value.cause, value.lastError);
        if (Array.isArray(value.errors)) pending.push(...value.errors.slice(0, 10));
    }
    return false;
}
