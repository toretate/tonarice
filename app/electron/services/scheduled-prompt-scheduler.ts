import { randomUUID } from 'node:crypto';
import {
    scheduledPromptTaskInputSchema,
    type ScheduledPromptRun,
    type ScheduledPromptTask,
    type ScheduledPromptTaskInput
} from '../../src/types/scheduled-prompt-task';
import { calculateNextRunAt } from '../../src/utils/schedule-calculator';
import {
    ScheduledPromptRepository,
    type ScheduledPromptStoreData
} from './scheduled-prompt-repository';

const MAXIMUM_TIMER_DELAY = 2_147_000_000;
const MAXIMUM_CATCH_UP_AGE = 7 * 86_400_000;
const MAXIMUM_ADVANCE_ITERATIONS = 10_000;

export interface ScheduledPromptExecutionResult {
    resultText: string;
}

export type ScheduledPromptExecutor = (
    task: ScheduledPromptTask,
    run: ScheduledPromptRun
) => Promise<ScheduledPromptExecutionResult>;

export interface ScheduledPromptSchedulerOptions {
    now?: () => Date;
    createId?: () => string;
    onChanged?: () => void;
}

export class ScheduledPromptScheduler {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private queue = Promise.resolve();
    private readonly runningTaskIds = new Set<string>();
    private readonly now: () => Date;
    private readonly createId: () => string;
    private readonly onChanged?: () => void;

    public constructor(
        private readonly repository: ScheduledPromptRepository,
        private readonly execute: ScheduledPromptExecutor,
        options: ScheduledPromptSchedulerOptions = {}
    ) {
        this.now = options.now ?? (() => new Date());
        this.createId = options.createId ?? randomUUID;
        this.onChanged = options.onChanged;
    }

    public start() {
        void this.evaluateDueTasks();
    }

    public stop() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    public listTasks() {
        return this.repository.getData().tasks;
    }

    public listRuns() {
        return this.repository.getData().runs;
    }

    public createTask(input: ScheduledPromptTaskInput) {
        const validated = scheduledPromptTaskInputSchema.parse(input);
        const now = this.now();
        const task: ScheduledPromptTask = {
            ...validated,
            id: this.createId(),
            nextRunAt: calculateNextRunAt(validated.schedule, validated.timeZone, {
                after: now,
                anchor: now
            }).toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        };

        const data = this.repository.getData();
        data.tasks.push(task);
        this.save(data);
        this.scheduleNextEvaluation();
        return task;
    }

    public updateTask(id: string, input: ScheduledPromptTaskInput) {
        const validated = scheduledPromptTaskInputSchema.parse(input);
        const data = this.repository.getData();
        const index = data.tasks.findIndex((task) => task.id === id);
        if (index < 0) throw new Error('定期実行タスクが見つかりません。');

        const previous = data.tasks[index];
        const now = this.now();
        const nextTask: ScheduledPromptTask = {
            ...previous,
            ...validated,
            nextRunAt: calculateNextRunAt(validated.schedule, validated.timeZone, {
                after: now,
                anchor: new Date(previous.createdAt)
            }).toISOString(),
            updatedAt: now.toISOString()
        };
        data.tasks[index] = nextTask;
        this.save(data);
        this.scheduleNextEvaluation();
        return nextTask;
    }

    public setTaskEnabled(id: string, enabled: boolean) {
        const data = this.repository.getData();
        const task = data.tasks.find((candidate) => candidate.id === id);
        if (!task) throw new Error('定期実行タスクが見つかりません。');

        const now = this.now();
        task.enabled = enabled;
        task.updatedAt = now.toISOString();
        if (enabled && new Date(task.nextRunAt).getTime() <= now.getTime()) {
            task.nextRunAt = calculateNextRunAt(task.schedule, task.timeZone, {
                after: now,
                anchor: new Date(task.createdAt)
            }).toISOString();
        }
        this.save(data);
        this.scheduleNextEvaluation();
        return task;
    }

    public deleteTask(id: string) {
        const data = this.repository.getData();
        const taskCount = data.tasks.length;
        data.tasks = data.tasks.filter((task) => task.id !== id);
        if (data.tasks.length === taskCount) {
            throw new Error('定期実行タスクが見つかりません。');
        }
        this.save(data);
        this.scheduleNextEvaluation();
    }

    public runTaskNow(id: string) {
        const task = this.repository.getData().tasks.find((candidate) => candidate.id === id);
        if (!task) return Promise.reject(new Error('定期実行タスクが見つかりません。'));
        return this.enqueue(task.id, 'manual', this.now());
    }

    public async evaluateDueTasks() {
        this.stop();
        const now = this.now();
        const data = this.repository.getData();

        for (const task of data.tasks) {
            if (!task.enabled) continue;
            const nextRunAt = new Date(task.nextRunAt);
            if (nextRunAt.getTime() > now.getTime()) continue;

            const { latestDueAt, nextFutureAt } = this.advanceSchedule(task, now);
            task.nextRunAt = nextFutureAt.toISOString();
            task.updatedAt = now.toISOString();

            if (now.getTime() - latestDueAt.getTime() <= MAXIMUM_CATCH_UP_AGE) {
                void this.enqueue(task.id, 'scheduled', latestDueAt);
            } else {
                this.addSkippedRun(data, task, latestDueAt, now);
                task.lastRunAt = now.toISOString();
                task.lastStatus = 'skipped';
            }
        }

        data.lastCheckedAt = now.toISOString();
        this.save(data);
        this.scheduleNextEvaluation();
    }

    private advanceSchedule(task: ScheduledPromptTask, now: Date) {
        let latestDueAt = new Date(task.nextRunAt);
        let nextFutureAt = calculateNextRunAt(task.schedule, task.timeZone, {
            after: latestDueAt,
            anchor: new Date(task.createdAt)
        });

        for (let count = 0; nextFutureAt.getTime() <= now.getTime(); count++) {
            if (count >= MAXIMUM_ADVANCE_ITERATIONS) {
                throw new Error('定期実行タスクの補完計算回数が上限を超えました。');
            }
            latestDueAt = nextFutureAt;
            nextFutureAt = calculateNextRunAt(task.schedule, task.timeZone, {
                after: nextFutureAt,
                anchor: new Date(task.createdAt)
            });
        }

        return { latestDueAt, nextFutureAt };
    }

    private enqueue(
        taskId: string,
        trigger: ScheduledPromptRun['trigger'],
        scheduledAt: Date
    ) {
        if (this.runningTaskIds.has(taskId)) {
            return Promise.resolve(undefined);
        }

        this.runningTaskIds.add(taskId);
        const operation = this.queue.then(() =>
            this.executeTask(taskId, trigger, scheduledAt)
        );
        this.queue = operation.then(() => undefined, () => undefined);
        return operation.finally(() => {
            this.runningTaskIds.delete(taskId);
        });
    }

    private async executeTask(
        taskId: string,
        trigger: ScheduledPromptRun['trigger'],
        scheduledAt: Date
    ) {
        const initialData = this.repository.getData();
        const task = initialData.tasks.find((candidate) => candidate.id === taskId);
        if (!task) return undefined;

        const startedAt = this.now();
        const run: ScheduledPromptRun = {
            id: this.createId(),
            taskId: task.id,
            taskName: task.name,
            trigger,
            scheduledAt: scheduledAt.toISOString(),
            startedAt: startedAt.toISOString(),
            status: 'running'
        };
        initialData.runs.unshift(run);
        this.save(initialData);

        try {
            const result = await this.execute(task, run);
            return this.completeRun(run.id, taskId, {
                status: 'success',
                resultText: result.resultText
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : '定期実行タスクの実行に失敗しました。';
            return this.completeRun(run.id, taskId, {
                status: 'failed',
                errorCode: 'EXECUTION_FAILED',
                errorMessage: message
            });
        }
    }

    private completeRun(
        runId: string,
        taskId: string,
        result: Pick<ScheduledPromptRun, 'status' | 'resultText' | 'errorCode' | 'errorMessage'>
    ) {
        const data = this.repository.getData();
        const run = data.runs.find((candidate) => candidate.id === runId);
        const task = data.tasks.find((candidate) => candidate.id === taskId);
        if (!run) return undefined;

        const finishedAt = this.now().toISOString();
        Object.assign(run, result, { finishedAt });
        if (task) {
            task.lastRunAt = finishedAt;
            task.lastStatus = result.status === 'success' ? 'success' : 'failed';
            task.updatedAt = finishedAt;
        }
        this.save(data);
        return run;
    }

    private addSkippedRun(
        data: ScheduledPromptStoreData,
        task: ScheduledPromptTask,
        scheduledAt: Date,
        now: Date
    ) {
        data.runs.unshift({
            id: this.createId(),
            taskId: task.id,
            taskName: task.name,
            trigger: 'scheduled',
            scheduledAt: scheduledAt.toISOString(),
            startedAt: now.toISOString(),
            finishedAt: now.toISOString(),
            status: 'skipped',
            errorCode: 'CATCH_UP_EXPIRED',
            errorMessage: '7日より古い取りこぼしのため実行しませんでした。'
        });
    }

    private save(data: ScheduledPromptStoreData) {
        this.repository.replaceData(data);
        this.onChanged?.();
    }

    private scheduleNextEvaluation() {
        this.stop();
        const now = this.now().getTime();
        const nextTimestamp = this.repository.getData().tasks
            .filter((task) => task.enabled)
            .map((task) => new Date(task.nextRunAt).getTime())
            .filter(Number.isFinite)
            .sort((left, right) => left - right)[0];

        if (nextTimestamp === undefined) return;
        const delay = Math.min(
            Math.max(nextTimestamp - now, 0),
            MAXIMUM_TIMER_DELAY
        );
        this.timer = setTimeout(() => {
            void this.evaluateDueTasks();
        }, delay);
    }
}
