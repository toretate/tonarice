import { createTool } from '@mastra/core/tools';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { volumeTool } from '../../skills/tool-use/volume-tool';
import { observeTool } from './tool-observation';

export const mastraVolumeTool = createTool({
    id: 'adjustVolume',
    description: 'このPCのマスター音量を0から100の間で調整します。',
    inputSchema: z.object({ volume: z.number().min(0).max(100).describe('設定する音量') }),
    execute: async ({ volume }, { requestContext }) => {
        if (requestContext.get('volumeEnabled') !== true) return { error: '音量調整は無効です。' };
        if (requestContext.get('volumeUsed') === true) return { error: 'この発話では音量を調整済みです。' };
        requestContext.set('volumeUsed', true);
        console.info('[MastraTool] adjustVolumeの実行を開始');
        return observeTool(requestContext, 'adjustVolume', async () => {
        const authorize = requestContext.get('authorizeSideEffect');
        if (typeof authorize !== 'function') return { error: '操作確認を利用できないため音量を変更しませんでした。' };
        const refusal = await authorize('adjustVolume', { volume });
        if (refusal) return { error: refusal };
        const result = await volumeTool.implementation({ volume }, {} as never);
        if (result.includes('失敗')) {
            console.warn('[MastraTool] adjustVolumeの実行に失敗');
            return { error: '音量調整に失敗しました。' };
        }
        console.info('[MastraTool] adjustVolumeの実行が完了');
        return { message: result };
        }, result => 'error' in result, { volume });
    }
});

const allowedApps: Record<string, string> = {
    '電卓': 'calc.exe',
    calc: 'calc.exe',
    'メモ帳': 'notepad.exe',
    notepad: 'notepad.exe'
};

/**
 * モデル入力をコマンドとして解釈せず、許可済み実行ファイルだけを起動する。
 */
export const mastraAppLauncherTool = createTool({
    id: 'launchApp',
    description: 'このPCで電卓またはメモ帳を起動します。その他のアプリや任意のコマンドは起動できません。',
    inputSchema: z.object({ appName: z.enum(['電卓', 'calc', 'メモ帳', 'notepad']).describe('起動するアプリ名') }),
    execute: async ({ appName }, { requestContext }) => {
        if (requestContext.get('appLauncherEnabled') !== true) return { error: 'アプリ起動は無効です。' };
        if (requestContext.get('appLauncherUsed') === true) return { error: 'この発話ではアプリを起動済みです。' };
        if (process.platform !== 'win32') return { error: 'この環境ではアプリを起動できません。' };
        requestContext.set('appLauncherUsed', true);
        console.info('[MastraTool] launchAppの実行を開始');
        return observeTool(requestContext, 'launchApp', async () => {
        const authorize = requestContext.get('authorizeSideEffect');
        if (typeof authorize !== 'function') return { error: '操作確認を利用できないためアプリを起動しませんでした。' };
        const refusal = await authorize('launchApp', { appName });
        if (refusal) return { error: refusal };
        try {
            await new Promise<void>((resolve, reject) => {
                const child = spawn(allowedApps[appName], [], {
                    detached: true,
                    stdio: 'ignore',
                    shell: false
                });
                child.once('error', reject);
                child.once('spawn', () => {
                    child.unref();
                    resolve();
                });
            });
            console.info('[MastraTool] launchAppの実行が完了');
            return { message: `アプリケーション「${appName}」を起動しました。` };
        } catch {
            console.warn('[MastraTool] launchAppの実行に失敗');
            return { error: `アプリケーション「${appName}」の起動に失敗しました。` };
        }
        }, result => 'error' in result, { appName });
    }
});
