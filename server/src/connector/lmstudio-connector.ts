import { LMStudioClient } from '@lmstudio/sdk';

// HTTPエンドポイントをLM Studio SDK用のWebSocket形式に変換するヘルパー
function getSdkEndpoint(httpEndpoint: string): string {
    let wsEndpoint = (httpEndpoint || '').trim();
    if (!wsEndpoint) {
        return 'ws://127.0.0.1:1234';
    }
    if (wsEndpoint.startsWith('http://')) {
        wsEndpoint = wsEndpoint.replace('http://', 'ws://');
    } else if (wsEndpoint.startsWith('https://')) {
        wsEndpoint = wsEndpoint.replace('https://', 'wss://');
    } else if (!wsEndpoint.startsWith('ws://') && !wsEndpoint.startsWith('wss://')) {
        wsEndpoint = 'ws://' + wsEndpoint;
    }
    wsEndpoint = wsEndpoint.replace(/\/v1\/?$/, '');
    wsEndpoint = wsEndpoint.replace(/\/api\/v1(\/models)?\/?$/, '');
    if (wsEndpoint.endsWith('/')) {
        wsEndpoint = wsEndpoint.slice(0, -1);
    }
    return wsEndpoint;
}

export class LmStudioConnector {
    public static async generateResponse(params: {
        message: string;
        systemPrompt: string;
        model: string;
        endpoint: string;
        history?: any[];
        attachments?: any[];
    }): Promise<string> {
        const { message, systemPrompt, model, endpoint, history, attachments } = params;
        const sdkEndpoint = getSdkEndpoint(endpoint);
        const targetModel = model || 'unspecified';

        console.log(`[LmStudioConnector] Routing to LM Studio SDK: ${sdkEndpoint} (Model: ${targetModel})`);

        const client = new LMStudioClient({ baseUrl: sdkEndpoint });
        const llm = await client.llm.model(targetModel);

        const messagesPayload: any[] = [];
        if (systemPrompt && systemPrompt.trim()) {
            messagesPayload.push({ role: 'system', content: systemPrompt });
        }

        if (history && history.length > 0) {
            let firstUserFound = false;
            history.forEach((msg: any) => {
                const text = msg.text || '';
                const role = msg.sender === 'user' ? 'user' : 'assistant';
                
                if (role === 'user') {
                    firstUserFound = true;
                }
                
                // 最初の user メッセージが見つかるまでは assistant メッセージをスキップする
                if (firstUserFound && text.trim()) {
                    messagesPayload.push({
                        role,
                        content: text
                    });
                }
            });
        }

        // テキストファイルのデコード用ヘルパー
        const decodeDataUrlAsText = (dataUrl: string): string | null => {
            try {
                const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (!match) return null;
                const mimeType = match[1];
                const base64Data = match[2];
                const isText = mimeType.startsWith('text/') || 
                               mimeType.includes('json') || 
                               mimeType.includes('javascript') ||
                               mimeType.includes('xml') ||
                               mimeType.includes('yaml') ||
                               mimeType.includes('html');
                if (isText) {
                    const buffer = Buffer.from(base64Data, 'base64');
                    return buffer.toString('utf-8');
                }
            } catch (e) {
                console.error('[LmStudioConnector] Failed to decode data URL as text:', e);
            }
            return null;
        };

        let finalMessage = message || '';

        // テキストファイルなどの添付処理
        if (attachments && attachments.length > 0) {
            const fileTexts: string[] = [];
            for (const att of attachments) {
                if (att.type === 'file' && att.url.startsWith('data:')) {
                    const textContent = decodeDataUrlAsText(att.url);
                    if (textContent !== null) {
                        fileTexts.push(`--- 添付ファイル: ${att.name} ---\n${textContent}\n---`);
                    } else {
                        fileTexts.push(`[添付ファイル: ${att.name} (バイナリ形式のためテキストプレビューはスキップされました)]`);
                    }
                }
            }
            if (fileTexts.length > 0) {
                finalMessage = `${finalMessage}\n\n${fileTexts.join('\n\n')}`.trim();
            }
        }

        // 今回のメッセージ（画像添付ありを考慮）
        const userContent: any[] = [];
        const hasImages = attachments && attachments.some(att => att.type === 'image' && att.url.startsWith('data:'));

        if (hasImages) {
            userContent.push({ type: 'text', text: finalMessage.trim() || '添付された画像を確認してください。' });
            for (const att of attachments || []) {
                if (att.type === 'image' && att.url.startsWith('data:')) {
                    const match = att.url.match(/^data:(image\/\w+);base64,(.+)$/);
                    if (match) {
                        userContent.push({
                            type: 'image',
                            image: {
                                base64: match[2]
                            }
                        });
                    }
                }
            }
        }

        messagesPayload.push({
            role: 'user',
            content: hasImages ? userContent : (finalMessage.trim() || 'こんにちは')
        });

        console.log("[LmStudioConnector] Final messagesPayload sent to LM Studio SDK:", JSON.stringify(messagesPayload, null, 2));
        const response = await llm.respond(messagesPayload);
        const rawContent = response.content || '';
        
        // 思考プロセス（Thinking Process や <think>, <thought> タグ、思考ステップ分析）の徹底的なクレンジング
        let cleanedContent = rawContent
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*/gi, '')
            .replace(/<\/think>[\s\S]*/gi, '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
            .replace(/<thought>[\s\S]*/gi, '')
            .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
            .replace(/<\|channel>thought[\s\S]*/gi, '')
            .replace(/^Thinking Process:[\s\S]*?(?=\n\n\S|$)/i, '')
            .replace(/\nThinking Process:[\s\S]*?(?=\n\n\S|$)/g, '');

        // `1. **Analyze the Request:**` や `* **Input:**` 等のマークダウン推論ログが残ってしまった場合のトリミング
        if (cleanedContent.includes('**Analyze') || cleanedContent.includes('**Determine')) {
            // thinkブロックの残りカスやステップ分析の最終行以降（通常最後のセリフなど）を取り出す
            // `cw </think>` のような残りがある場合はそれを除去
            cleanedContent = cleanedContent.replace(/^[\s\S]*<\/think>/gi, '');
            // それでも推論ステップが残っている場合、最後の段落やタグ付きのセリフだけを抽出する
            const paragraphs = cleanedContent.split('\n\n').map(p => p.trim()).filter(Boolean);
            if (paragraphs.length > 0) {
                // 最後の段落が「こんにちは！」などのセリフである確率が高いため、最後を取得
                const lastParagraph = paragraphs[paragraphs.length - 1];
                if (!lastParagraph.includes('**') && !lastParagraph.includes('Analyze')) {
                    cleanedContent = lastParagraph;
                }
            }
        }

        // 単体で残った `cw </think>` や `</think>` 等のゴミを除去
        cleanedContent = cleanedContent.replace(/^[\s\S]*?<\/think>\s*/gi, '');

        return cleanedContent.trim();
    }
}
