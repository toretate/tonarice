import { describe, expect, it } from 'vitest';
import { buildMastraChatInstructions, buildMastraChatMessages } from '../chat-input';

describe('buildMastraChatMessagesのテスト', () => {
    it('buildMastraChatMessages_履歴の順序と現在の発話を保持すること', () => {
        const messages = buildMastraChatMessages('次を教えて', [
            { sender: 'mascot', text: '前の返事' },
            { sender: 'user', text: '前の質問' },
            { sender: 'mascot', text: '答え' }
        ]);

        expect(messages).toEqual([
            { role: 'user', content: 'こんにちは' },
            { role: 'assistant', content: '前の返事' },
            { role: 'user', content: '前の質問' },
            { role: 'assistant', content: '答え' },
            { role: 'user', content: '次を教えて' }
        ]);
    });

    it('buildMastraChatMessages_テキストファイルと画像を同じ発話へ添付すること', () => {
        const fileData = Buffer.from('メモの内容').toString('base64');
        const messages = buildMastraChatMessages('内容を見て', [], [
            { type: 'file', name: 'memo.txt', url: `data:text/plain;base64,${fileData}` },
            { type: 'image', name: 'photo.png', url: 'data:image/png;base64,aGVsbG8=' }
        ]);

        expect(messages).toEqual([{
            role: 'user',
            content: [
                { type: 'text', text: '内容を見て\n\n--- 添付ファイル: memo.txt ---\nメモの内容\n---' },
                { type: 'image', image: 'aGVsbG8=', mediaType: 'image/png' }
            ]
        }]);
    });

    it('buildMastraChatMessages_バイナリ添付を実行可能な入力として扱わないこと', () => {
        const messages = buildMastraChatMessages('', [], [
            { type: 'file', name: 'archive.zip', url: 'data:application/zip;base64,aGVsbG8=' }
        ]);

        expect(messages).toEqual([{
            role: 'user',
            content: '[添付ファイル: archive.zip (バイナリ形式のためテキストプレビューはスキップされました)]'
        }]);
    });
});

describe('buildMastraChatInstructionsのテスト', () => {
    it('buildMastraChatInstructions_ペルソナと日時を保持しツール実行を装わないこと', () => {
        const instructions = buildMastraChatInstructions('マスコットの性格', new Date('2026-10-10T00:00:00Z'));

        expect(instructions).toContain('マスコットの性格');
        expect(instructions).toContain('[現在のシステム日時]');
        expect(instructions).toContain('操作を実行したと装わず');
    });
});
