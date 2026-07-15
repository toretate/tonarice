const TTS_DICTIONARY_VALUE_REGEX = /^[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3005\u3006\u3007ー・\s、。！？]*$/;

/** TTS辞書の読みとして保存可能な文字列かを判定します。 */
export function isValidTtsDictionaryValue(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 256
        && TTS_DICTIONARY_VALUE_REGEX.test(value);
}

/**
 * 選択文からAIに読みを問い合わせる英数字表記を抽出します。
 * URLなどの長大な値と、同じ表記の大文字小文字違いは除外します。
 */
export function extractEnglishTermsForTtsDictionary(text: string, limit = 50): string[] {
    if (!text || limit <= 0) return [];

    const terms: string[] = [];
    const seen = new Set<string>();
    const matches = text.match(/[A-Za-z][A-Za-z0-9+#.'/-]*/g) || [];

    for (const rawMatch of matches) {
        const term = rawMatch.replace(/[.'/-]+$/g, '');
        const normalized = term.toLowerCase();
        if (!term || term.length > 64 || seen.has(normalized)) continue;

        seen.add(normalized);
        terms.push(term);
        if (terms.length >= limit) break;
    }

    return terms;
}
