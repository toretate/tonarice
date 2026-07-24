import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    ScheduledPromptRun,
    ScheduledPromptTask
} from '../../src/types/scheduled-prompt-task';

export interface ScheduledPromptStoreData {
    tasks: ScheduledPromptTask[];
    runs: ScheduledPromptRun[];
    lastCheckedAt?: string;
}

const EMPTY_STORE: ScheduledPromptStoreData = {
    tasks: [],
    runs: []
};

const MAX_RUNS = 1_000;
const MAX_RUN_AGE_MILLISECONDS = 90 * 86_400_000;

const cloneStore = (store: ScheduledPromptStoreData): ScheduledPromptStoreData =>
    JSON.parse(JSON.stringify(store));

export class ScheduledPromptRepository {
    private readonly backupPath: string;
    private data: ScheduledPromptStoreData;
    private readOnly = false;

    public constructor(private readonly filePath: string) {
        this.backupPath = `${filePath}.bak`;
        this.data = this.load();
    }

    public getData() {
        return cloneStore(this.data);
    }

    public isReadOnly() {
        return this.readOnly;
    }

    public replaceData(nextData: ScheduledPromptStoreData) {
        if (this.readOnly) {
            throw new Error('定期実行タスクの保存先が読み取り専用です。');
        }

        const normalized = this.normalize(nextData);
        this.write(normalized);
        this.data = normalized;
        return this.getData();
    }

    private load(): ScheduledPromptStoreData {
        if (!fs.existsSync(this.filePath)) return cloneStore(EMPTY_STORE);

        try {
            const source = fs.readFileSync(this.filePath, 'utf8');
            const parsed = this.parse(source);
            this.createBackup(source);
            return parsed;
        } catch (error) {
            console.warn('[ScheduledPrompt] 保存データの読み込みに失敗しました。バックアップを確認します。');
            try {
                if (fs.existsSync(this.backupPath)) {
                    const backup = fs.readFileSync(this.backupPath, 'utf8');
                    const restored = this.parse(backup);
                    this.write(restored);
                    return restored;
                }
            } catch {
                console.warn('[ScheduledPrompt] バックアップからの復元に失敗しました。');
            }

            this.readOnly = true;
            return cloneStore(EMPTY_STORE);
        }
    }

    private parse(source: string): ScheduledPromptStoreData {
        const parsed = JSON.parse(source) as Partial<ScheduledPromptStoreData>;
        if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.runs)) {
            throw new TypeError('保存データの形式が不正です。');
        }
        return this.normalize({
            tasks: parsed.tasks,
            runs: parsed.runs,
            lastCheckedAt: parsed.lastCheckedAt
        });
    }

    private normalize(data: ScheduledPromptStoreData): ScheduledPromptStoreData {
        const cutoff = Date.now() - MAX_RUN_AGE_MILLISECONDS;
        const runs = [...data.runs]
            .filter((run) => {
                const timestamp = new Date(run.startedAt).getTime();
                return Number.isFinite(timestamp) && timestamp >= cutoff;
            })
            .sort((left, right) =>
                new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
            )
            .slice(0, MAX_RUNS);

        return {
            tasks: [...data.tasks],
            runs,
            lastCheckedAt: data.lastCheckedAt
        };
    }

    private createBackup(source: string) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryBackupPath = `${this.backupPath}.tmp`;
        fs.writeFileSync(temporaryBackupPath, source, 'utf8');
        fs.renameSync(temporaryBackupPath, this.backupPath);
    }

    private write(data: ScheduledPromptStoreData) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 4), 'utf8');
        fs.renameSync(temporaryPath, this.filePath);
    }
}
