/** 保存前後で同じ会話タイトルを表示する。 */
export function createChatSessionTitle(message: string): string {
    return message ? message.slice(0, 15) + (message.length > 15 ? '...' : '') : '新しい話題';
}
