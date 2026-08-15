import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { attachRendererConsoleLogger } from '../renderer-console-logger';

describe('attachRendererConsoleLogger のテスト', () => {
    it('attachRendererConsoleLogger_console-messageの詳細オブジェクトをログへ出力すること', () => {
        const on = vi.fn();
        const webContents = { on } as unknown as WebContents;
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        attachRendererConsoleLogger(webContents, 'Test');

        expect(on).toHaveBeenCalledWith('console-message', expect.any(Function));
        const listener = on.mock.calls[0][1];
        listener({
            level: 'warning',
            message: 'テストメッセージ',
            lineNumber: 42,
            sourceId: 'app://renderer.js',
            frame: {}
        });

        expect(consoleLog).toHaveBeenCalledWith(
            '[Renderer Log - Test] [Level: warning] テストメッセージ (Source: app://renderer.js:42)'
        );
        consoleLog.mockRestore();
    });
});
