import { z } from 'zod';

export const webSearchDescription = 'インターネット検索を行い、Webページのタイトル、要約、URLを最大3件取得します。';
export const webSearchInputSchema = z.object({
    query: z.string().trim().min(1).max(200).describe('検索キーワード')
});

export interface WebSearchResult {
    title: string;
    snippet: string;
    url: string;
}

function decodeHtml(value: string): string {
    return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code: string) => {
        const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
        if (code.startsWith('#')) {
            const hex = code[1]?.toLowerCase() === 'x';
            const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
            return Number.isFinite(number) && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
        }
        return named[code.toLowerCase()] ?? entity;
    });
}

function cleanText(value: string): string {
    return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function resolveResultUrl(raw: string): string | null {
    try {
        const url = new URL(decodeHtml(raw), 'https://duckduckgo.com');
        const target = url.hostname === 'duckduckgo.com' && url.pathname === '/l/'
            ? new URL(url.searchParams.get('uddg') || '')
            : url;
        return target.protocol === 'https:' || target.protocol === 'http:' ? target.toString() : null;
    } catch {
        return null;
    }
}

function parseSearchResults(html: string): WebSearchResult[] {
    const results: WebSearchResult[] = [];
    const liteLinks = /<a\b([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b[^>]*class=['"]result-link['"]|$)/gi;
    for (const match of html.matchAll(liteLinks)) {
        const href = match[1].match(/href=['"]([^'"]+)['"]/i)?.[1];
        const url = href ? resolveResultUrl(href) : null;
        if (!url) continue;
        const snippet = match[3].match(/<td\s+class=['"]result-snippet['"]>([\s\S]*?)<\/td>/i)?.[1] || '';
        results.push({ title: cleanText(match[2]), snippet: cleanText(snippet), url });
        if (results.length === 3) return results;
    }

    // 旧HTML形式も読み取れるようにし、既存経路の回帰を避ける。
    const blocks = html.split('<div class="result results_links results_links_deep web-result');
    for (let index = 1; index < blocks.length && results.length < 3; index++) {
        const block = blocks[index];
        const title = block.match(/<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!title) continue;
        const url = resolveResultUrl(title[1]);
        if (!url) continue;
        const snippet = block.match(/<a\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        results.push({ title: cleanText(title[2]), snippet: snippet ? cleanText(snippet[1]) : '', url });
    }
    return results;
}

/**
 * 既存経路とMastra経路で共用するWeb検索処理。
 */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResult[] | string> {
    console.info('[WebSearch] DuckDuckGoとの通信を開始');
    try {
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal
        });
        if (!response.ok) {
            console.warn('[WebSearch] DuckDuckGoとの通信に失敗');
            return 'Web検索に失敗しました。';
        }
        const html = await response.text();
        const results = parseSearchResults(html);
        console.info('[WebSearch] DuckDuckGoとの通信が完了');
        return results.length > 0 ? results : '検索結果が見つかりませんでした。';
    } catch {
        console.warn('[WebSearch] DuckDuckGoとの接続エラー');
        return 'Web検索中にエラーが発生しました。';
    }
}
