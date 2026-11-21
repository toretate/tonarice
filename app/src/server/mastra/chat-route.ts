import { isLmStudioTemplateError, LMSTUDIO_TEMPLATE_ERROR_MESSAGE } from '../utils/lmstudio-template-error';

/**
 * API応答本文や認証情報を画面・ログへ転送しないエラー文へ変換する。
 */
export function getMastraChatErrorMessage(error: unknown, engine: string): string {
    if (engine === 'lmstudio' && isLmStudioTemplateError(error)) return LMSTUDIO_TEMPLATE_ERROR_MESSAGE;
    if (error instanceof Error && error.message.includes('API KEYが設定されていません')) {
        return `${engine === 'openai' ? 'OpenAI' : 'Gemini'} API KEYが設定されていません。設定画面の「APIキー」から設定してください。`;
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.message.includes('timeout'))) {
        return `${engine}との接続がタイムアウトしました。`;
    }
    return `${engine}との接続エラーが発生しました。設定と通信状態を確認してください。`;
}
