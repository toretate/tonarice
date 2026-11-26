function removeRepetitiveLoops(text: string) {
    if (!text) return text;
    const sentences = text.split(/([。！？\n]+)/);
    const cleaned: string[] = [];

    for (const sentence of sentences) {
        const current = sentence.trim();
        if (!current) {
            cleaned.push(sentence);
            continue;
        }
        const previous = [...cleaned].reverse().find(value => value.trim());
        if (previous?.trim() === current) {
            if (current.length > 10) break;
        } else {
            cleaned.push(sentence);
        }
    }

    return cleaned.join('').replace(/(.{12,300}?)\1+/g, '$1').trim();
}

/** Mastra Agent の出力から推論用タグと連続リピートを取り除く。 */
export function cleanCoWorkResult(raw: string) {
    let content = raw || '';
    if (content.includes('</think>')) content = content.split(/<\/think>/i).pop() || '';
    if (content.includes('</thought>')) content = content.split(/<\/thought>/i).pop() || '';
    if (content.includes('channel|>')) content = content.split(/channel\|>/gi).pop() || '';

    content = content
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*/gi, '')
        .replace(/<\/think>[\s\S]*/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<thought>[\s\S]*/gi, '')
        .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
        .replace(/<\|channel>thought[\s\S]*/gi, '')
        .replace(/^Thinking Process:[\s\S]*?(?=\n\n\S|$)/i, '')
        .replace(/\nThinking Process:[\s\S]*?(?=\n\n\S|$)/g, '');

    const cleaned = removeRepetitiveLoops(content);
    return cleaned || '応答本文を取得できませんでした。';
}
