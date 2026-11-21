const ENABLED_VALUES = new Set(['1', 'true']);

/**
 * Mastraチャットは既定で有効。明示設定がある場合は従来の判定に従う。
 */
export function isMastraChatEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    const value = env.MASTRA_CHAT_ENABLED?.trim().toLowerCase();
    return value === undefined || ENABLED_VALUES.has(value);
}
