import type { ModelMessage } from 'ai';
import toolUseGuidelineTemplate from '@prompt/tool-use-guideline';
import weatherPrompt from '../../skills/tool-use/prompts/getWeather.prompt';

export interface MastraChatHistoryItem {
    sender?: string;
    text?: string;
}

export interface MastraChatAttachment {
    type?: string;
    name?: string;
    url?: string;
}

/**
 * 既存チャットと同じ履歴・添付形式をAgent用メッセージへ変換する。
 */
export function buildMastraChatMessages(
    message: string,
    history: readonly MastraChatHistoryItem[] = [],
    attachments: readonly MastraChatAttachment[] = []
): ModelMessage[] {
    const messages: ModelMessage[] = [];

    if (history.length > 0 && history[0]?.sender !== 'user') {
        messages.push({ role: 'user', content: 'こんにちは' });
    }

    for (const item of history) {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) continue;
        messages.push({
            role: item.sender === 'user' ? 'user' : 'assistant',
            content: text
        });
    }

    const fileTexts: string[] = [];
    const imageParts: Array<{ type: 'image'; image: string; mediaType: string }> = [];
    for (const attachment of attachments) {
        if (typeof attachment.url !== 'string' || !attachment.url.startsWith('data:')) continue;

        if (attachment.type === 'file') {
            const match = attachment.url.match(/^data:([^;]+);base64,(.+)$/s);
            if (!match) continue;
            const mediaType = match[1].toLowerCase();
            const name = attachment.name || '名称未設定';
            if (/^text\//.test(mediaType) || /(json|javascript|xml|yaml|html)/.test(mediaType)) {
                fileTexts.push(`--- 添付ファイル: ${name} ---\n${Buffer.from(match[2], 'base64').toString('utf-8')}\n---`);
            } else {
                fileTexts.push(`[添付ファイル: ${name} (バイナリ形式のためテキストプレビューはスキップされました)]`);
            }
        } else if (attachment.type === 'image') {
            const match = attachment.url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
            if (match) {
                imageParts.push({
                    type: 'image',
                    image: match[2],
                    mediaType: match[1]
                });
            }
        }
    }

    const finalText = [message || '', ...fileTexts].filter(Boolean).join('\n\n').trim() || 'こんにちは';
    messages.push({
        role: 'user',
        content: imageParts.length > 0
            ? [{ type: 'text', text: finalText }, ...imageParts]
            : finalText
    });
    return messages;
}

/**
 * 利用可能なツールを明示し、未移行の操作完了を装わないよう指示する。
 */
export function buildMastraChatInstructions(
    systemPrompt: string,
    options: { weatherEnabled?: boolean; now?: Date } = {}
): string {
    const toolUseSection = options.weatherEnabled
        ? `${weatherPrompt}\n- 天気ツールの結果がエラーなら現在の天気を推測しないでください。\n- この経路ではウェブ検索、タスク・メモなど他のツールは利用できません。操作を実行したと装わないでください。`
        : '- この経路ではツールを利用できません。登録・変更・検索などの操作を実行したと装わず、必要な場合は利用できないと伝えてください。';
    const toolUseGuideline = toolUseGuidelineTemplate.replace('{{toolUseSection}}', () => toolUseSection);
    const now = options.now || new Date();
    const nowStr = now.toLocaleString('ja-JP', {
        year: 'numeric', month: 'numeric', day: 'numeric',
        weekday: 'short', hour: '2-digit', minute: '2-digit'
    });
    return `${systemPrompt || ''}\n\n${toolUseGuideline}\n\n[現在のシステム日時]\n${nowStr}`;
}
