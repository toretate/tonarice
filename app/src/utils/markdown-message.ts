export interface MarkdownInlineNode {
    type: 'text' | 'strong' | 'emphasis' | 'code' | 'strike' | 'link';
    text: string;
    href?: string;
}

export type MarkdownBlock =
    | { type: 'heading'; level: number; content: MarkdownInlineNode[] }
    | { type: 'paragraph' | 'blockquote'; content: MarkdownInlineNode[] }
    | { type: 'list'; ordered: boolean; items: MarkdownInlineNode[][] }
    | { type: 'code'; language: string; text: string }
    | { type: 'table'; headers: MarkdownInlineNode[][]; rows: MarkdownInlineNode[][][] }
    | { type: 'separator' };

const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const SEPARATOR_REGEX = /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/;
const LIST_REGEX = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/;

function sanitizeLink(url: string): string | undefined {
    const trimmed = url.trim();
    return /^(?:https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : undefined;
}

/** Markdownのインライン装飾を、HTMLを使わない表示用ノードへ分解します。 */
export function parseMarkdownInline(text: string): MarkdownInlineNode[] {
    const nodes: MarkdownInlineNode[] = [];
    let remaining = text;

    const rules: Array<{
        type: MarkdownInlineNode['type'];
        regex: RegExp;
        toNode?: (match: RegExpMatchArray) => MarkdownInlineNode;
    }> = [
        { type: 'link', regex: /\[([^\]]+)\]\(([^)]+)\)/, toNode: match => ({ type: 'link', text: match[1], href: sanitizeLink(match[2]) }) },
        { type: 'strong', regex: /\*\*([^*]+)\*\*/ },
        { type: 'strong', regex: /__([^_]+)__/ },
        { type: 'code', regex: /`([^`]+)`/ },
        { type: 'strike', regex: /~~([^~]+)~~/ },
        { type: 'emphasis', regex: /\*([^*]+)\*/ },
        { type: 'emphasis', regex: /_([^_]+)_/ }
    ];

    while (remaining) {
        let selectedRule: typeof rules[number] | undefined;
        let selectedMatch: RegExpMatchArray | null = null;

        for (const rule of rules) {
            const match = remaining.match(rule.regex);
            if (match && (!selectedMatch || (match.index ?? 0) < (selectedMatch.index ?? 0))) {
                selectedRule = rule;
                selectedMatch = match;
            }
        }

        if (!selectedRule || !selectedMatch) {
            nodes.push({ type: 'text', text: remaining });
            break;
        }

        const index = selectedMatch.index ?? 0;
        if (index > 0) nodes.push({ type: 'text', text: remaining.slice(0, index) });

        nodes.push(selectedRule.toNode
            ? selectedRule.toNode(selectedMatch)
            : { type: selectedRule.type, text: selectedMatch[1] });
        remaining = remaining.slice(index + selectedMatch[0].length);
    }

    return nodes;
}

function splitTableRow(line: string): MarkdownInlineNode[][] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => parseMarkdownInline(cell.trim()));
}

function startsBlock(lines: string[], index: number): boolean {
    const line = lines[index] || '';
    const nextLine = lines[index + 1] || '';
    return !line.trim()
        || /^\s*```/.test(line)
        || /^\s*#{1,6}\s+/.test(line)
        || /^\s*>\s?/.test(line)
        || LIST_REGEX.test(line)
        || SEPARATOR_REGEX.test(line)
        || (line.includes('|') && TABLE_SEPARATOR_REGEX.test(nextLine));
}

/** AI応答のMarkdownを安全な表示用ブロックへ分解します。 */
export function parseMarkdownMessage(text: string): MarkdownBlock[] {
    if (!text) return [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const blocks: MarkdownBlock[] = [];

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        if (!line.trim()) {
            index++;
            continue;
        }

        const fenceMatch = line.match(/^\s*```\s*([^\s`]*)/);
        if (fenceMatch) {
            const codeLines: string[] = [];
            index++;
            while (index < lines.length && !/^\s*```/.test(lines[index])) {
                codeLines.push(lines[index]);
                index++;
            }
            if (index < lines.length) index++;
            blocks.push({ type: 'code', language: fenceMatch[1] || '', text: codeLines.join('\n') });
            continue;
        }

        const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            blocks.push({ type: 'heading', level: headingMatch[1].length, content: parseMarkdownInline(headingMatch[2].trim()) });
            index++;
            continue;
        }

        if (line.includes('|') && TABLE_SEPARATOR_REGEX.test(lines[index + 1] || '')) {
            const headers = splitTableRow(line);
            const rows: MarkdownInlineNode[][][] = [];
            index += 2;
            while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                rows.push(splitTableRow(lines[index]));
                index++;
            }
            blocks.push({ type: 'table', headers, rows });
            continue;
        }

        const listMatch = line.match(LIST_REGEX);
        if (listMatch) {
            const ordered = !!listMatch[2];
            const items: MarkdownInlineNode[][] = [];
            while (index < lines.length) {
                const itemMatch = lines[index].match(LIST_REGEX);
                if (!itemMatch || !!itemMatch[2] !== ordered) break;
                items.push(parseMarkdownInline(itemMatch[3].trim()));
                index++;
            }
            blocks.push({ type: 'list', ordered, items });
            continue;
        }

        if (/^\s*>\s?/.test(line)) {
            const quoteLines: string[] = [];
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s*>\s?/, '').trim());
                index++;
            }
            blocks.push({ type: 'blockquote', content: parseMarkdownInline(quoteLines.join(' ')) });
            continue;
        }

        if (SEPARATOR_REGEX.test(line)) {
            blocks.push({ type: 'separator' });
            index++;
            continue;
        }

        const paragraphLines: string[] = [];
        while (index < lines.length && !startsBlock(lines, index)) {
            paragraphLines.push(lines[index].trim());
            index++;
        }
        if (paragraphLines.length > 0) {
            blocks.push({ type: 'paragraph', content: parseMarkdownInline(paragraphLines.join(' ')) });
        } else {
            // 未対応の記法で無限ループにならないよう、通常段落として表示する。
            blocks.push({ type: 'paragraph', content: parseMarkdownInline(line.trim()) });
            index++;
        }
    }

    return blocks;
}
