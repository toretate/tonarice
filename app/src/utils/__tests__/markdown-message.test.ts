import { describe, expect, test } from 'vitest';
import { parseMarkdownInline, parseMarkdownMessage } from '../markdown-message';

describe('Markdownメッセージ解析', () => {
    test('parseMarkdownMessage - 見出し・段落・リスト・表・コードを構造化すること', () => {
        const blocks = parseMarkdownMessage([
            '### 🎯 主な特徴',
            '',
            '**SBOM** を作成します。',
            '',
            '- 脆弱性を検出',
            '- リスクを管理',
            '',
            '| ツール | 役割 |',
            '| --- | --- |',
            '| Dependency-Track | 分析 |',
            '',
            '```ts',
            'const safe = true;',
            '```'
        ].join('\n'));

        expect(blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'list', 'table', 'code']);
        expect(blocks[0]).toMatchObject({ type: 'heading', level: 3 });
        expect(blocks[2]).toMatchObject({ type: 'list', ordered: false });
        expect(blocks[4]).toMatchObject({ type: 'code', language: 'ts', text: 'const safe = true;' });
    });

    test('parseMarkdownInline - 強調と安全なリンクだけを構造化すること', () => {
        expect(parseMarkdownInline('**重要** [公式](https://example.com)')).toEqual([
            { type: 'strong', text: '重要' },
            { type: 'text', text: ' ' },
            { type: 'link', text: '公式', href: 'https://example.com' }
        ]);
        expect(parseMarkdownInline('[危険](javascript:alert(1))')[0]).toEqual({
            type: 'link',
            text: '危険',
            href: undefined
        });
    });

    test('parseMarkdownMessage - HTMLを実行用ノードに変換せず文字列として保持すること', () => {
        expect(parseMarkdownMessage('<script>alert("xss")</script>')).toEqual([
            {
                type: 'paragraph',
                content: [{ type: 'text', text: '<script>alert("xss")</script>' }]
            }
        ]);
    });
});
