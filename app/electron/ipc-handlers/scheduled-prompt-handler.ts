import { app, ipcMain } from 'electron';
import * as path from 'node:path';
import type { ScheduledPromptTaskInput } from '../../src/types/scheduled-prompt-task';
import { ChatAiService } from '../../src/server/utils/chat-ai-service';
import { ScheduledPromptScheduler } from '../services/scheduled-prompt-scheduler';
import { ScheduledPromptRepository } from '../services/scheduled-prompt-repository';
import { getChatWindow } from '../window/chat-window';
import { getCompactWindow } from '../window/compact-window';
import { getIntegratedWindow } from '../window/integrated-window';

let scheduler: ScheduledPromptScheduler | null = null;

const getStorePath = () => {
    if (!app.isPackaged) {
        return path.resolve(__dirname, '../../../storage/scheduled-prompt-tasks.json');
    }
    return path.join(app.getPath('userData'), 'scheduled-prompt-tasks.json');
};

const broadcastChanged = () => {
    for (const window of [getChatWindow(), getIntegratedWindow(), getCompactWindow()]) {
        if (window && !window.isDestroyed()) {
            window.webContents.send('scheduled-prompt:changed');
        }
    }
};

const requireScheduler = () => {
    if (!scheduler) throw new Error('定期実行スケジューラが初期化されていません。');
    return scheduler;
};

export function registerScheduledPromptHandlers(getConfig: () => Record<string, any>) {
    const repository = new ScheduledPromptRepository(getStorePath());
    scheduler = new ScheduledPromptScheduler(repository, async (task) => {
        const config = getConfig();
        const engine = config.selectedEngine || 'gemini';
        const apiKey = engine === 'openai'
            ? config.openaiApiKey || ''
            : engine === 'anthropic'
                ? config.anthropicApiKey || ''
                : config.googleAiStudioApiKey || '';
        const model = engine === 'openai'
            ? config.openaiModel || 'gpt-4o'
            : engine === 'anthropic'
                ? config.anthropicModel || 'claude-3-5-sonnet-latest'
                : engine === 'lmstudio'
                    ? config.lmstudioModel || ''
                    : config.geminiModel || 'gemini-1.5-flash';

        const resultText = await ChatAiService.generateResponse({
            message: task.prompt,
            apiKey,
            systemPrompt: [
                'あなたはデスクトップマスコットの CoWork アシスタントです。',
                '定期実行された依頼に対し、実行結果が後から読んでも分かる形で簡潔に報告してください。'
            ].join('\n'),
            model,
            engine,
            lmstudioEndpoint: config.lmstudioEndpoint,
            temperature: config.temperature,
            frequencyPenalty: config.frequencyPenalty,
            repetitionPenalty: config.repetitionPenalty,
            maxOutputTokens: config.maxOutputTokens,
            enableThinking: config.enableThinking,
            tools: {}
        });
        return { resultText };
    }, {
        onChanged: broadcastChanged
    });

    ipcMain.handle('scheduled-prompt:list', () => ({
        tasks: requireScheduler().listTasks(),
        runs: requireScheduler().listRuns(),
        readOnly: repository.isReadOnly()
    }));

    ipcMain.handle(
        'scheduled-prompt:create',
        (_event, input: ScheduledPromptTaskInput) => {
            const task = requireScheduler().createTask(input);
            broadcastChanged();
            return task;
        }
    );

    ipcMain.handle(
        'scheduled-prompt:update',
        (_event, id: string, input: ScheduledPromptTaskInput) => {
            const task = requireScheduler().updateTask(id, input);
            broadcastChanged();
            return task;
        }
    );

    ipcMain.handle(
        'scheduled-prompt:set-enabled',
        (_event, id: string, enabled: boolean) => {
            const task = requireScheduler().setTaskEnabled(id, enabled);
            broadcastChanged();
            return task;
        }
    );

    ipcMain.handle('scheduled-prompt:delete', (_event, id: string) => {
        requireScheduler().deleteTask(id);
        broadcastChanged();
    });

    ipcMain.handle('scheduled-prompt:run-now', async (_event, id: string) => {
        const result = await requireScheduler().runTaskNow(id);
        broadcastChanged();
        return result;
    });

    scheduler.start();
}

export function stopScheduledPromptScheduler() {
    scheduler?.stop();
    scheduler = null;
}
