/**
 * 以前の発話に残ったQwen系の思考切替指示を、次の要求へ持ち越さない。
 */
export function stripNoThinkDirective(text: string): string {
    return text
        .replace(/(?:\s*\/no_think)+\s*$/gi, '')
        .replace(/^\s*(?:\/no_think\s*)+/gi, '')
        .replace(/(?<=\s)\/no_think(?=\s)/gi, '');
}
