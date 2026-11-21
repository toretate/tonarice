import type { WebContents } from 'electron';

/**
 * Renderer のコンソール出力をメインプロセスへ転送する。
 */
export function attachRendererConsoleLogger(webContents: WebContents, windowName: string): void {
    webContents.on('console-message', (details) => {
        const { level, message, lineNumber, sourceId } = details;
        console.log(
            `[Renderer Log - ${windowName}] [Level: ${level}] ${message} (Source: ${sourceId}:${lineNumber})`
        );
    });
}
