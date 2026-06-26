import { defineEventHandler, readBody, createError } from 'h3';
import { ChatAiService } from '../utils/chat-ai-service';

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event);
        const {
            currentMemory,
            chatHistory,
            engine,
            model,
            apiKey,
            lmstudioEndpoint
        } = body as {
            currentMemory?: string;
            chatHistory?: string;
            engine?: string;
            model?: string;
            apiKey?: string;
            lmstudioEndpoint?: string;
        };

        if (currentMemory === undefined || chatHistory === undefined) {
            throw createError({
                statusCode: 400,
                statusMessage: 'currentMemory and chatHistory are required'
            });
        }

        console.log(`[Server] Memory update request: engine=${engine || 'default'}, model=${model || 'default'}`);

        const prompt = `提供された会話履歴から、ユーザー（マスター）に関する新しい事実（名前、趣味、好み、特徴など）や、マスコットとの重要な合意・約束・設定などを抽出してください。
その後、既存の「マスコット長期記憶（Memory.md）」の内容と突き合わせ、情報を更新・追加し、重複や古い情報を整理・マージした最新の Markdown 箇条書きを作成してください。

【既存のマスコット長期記憶（Memory.md）】
${currentMemory || 'なし'}

【今回の会話履歴】
${chatHistory}

【制約事項】
1. # Mascot Long-term Memory という大見出しを最上部に必ず含めてください。
2. 出力は、Markdown の箇条書き部分（# Mascot Long-term Memory で始まる内容）のみを返し、余計な説明文や解説、挨拶、会話文などは一切出力しないでください。
3. 以前の記憶と矛盾する新しい事実がある場合、新しい情報を優先して古い情報を書き換えるか削除してください。`;

        const memory = await ChatAiService.generateResponse({
            message: prompt,
            apiKey: apiKey || '',
            systemPrompt: 'あなたは優秀な対話分析・記憶管理アシスタントです。',
            model: model || '',
            engine: engine || 'gemini',
            lmstudioEndpoint: lmstudioEndpoint || 'http://127.0.0.1:1234/v1/',
            tools: {
                toolsCurrentTime: false,
                toolsGpsLocation: false,
                toolsWeather: false,
                toolsVolume: false,
                toolsAppLauncher: false,
                toolsWebSearch: false
            }
        });

        return { success: true, memory };
    } catch (error: any) {
        console.error('[Server] Memory update failed:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
