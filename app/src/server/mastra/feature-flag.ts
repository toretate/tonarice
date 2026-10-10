const ENABLED_VALUES = new Set(['1', 'true']);

/**
 * Mastraチャット経路が明示的に有効化されているか判定する。
 */
export function isMastraChatEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    const value = env.MASTRA_CHAT_ENABLED?.trim().toLowerCase();
    return value !== undefined && ENABLED_VALUES.has(value);
}
