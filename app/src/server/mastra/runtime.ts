import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LibSQLStore } from '@mastra/libsql';
import { Mastra } from '@mastra/core/mastra';
import { createMascotAgent, MASCOT_AGENT_ID } from './mascot-agent';
import { createCoWorkAgent } from './cowork-agent';
import { createCoWorkScheduleHooks } from '../cowork/mastra-schedules';
import { CoWorkRepository } from '../cowork/repository';
import { getDB } from '../utils/db';
import { STORAGE_DIR } from '../utils/paths';

let runtime: Mastra | null = null;
let shutdownController: AbortController | undefined;

export interface MastraRuntimeStatus {
    enabled: boolean;
    initialized: boolean;
}

/**
 * Nitroプロセス内でMastraランタイムを遅延初期化する。
 */
export function getMastraRuntime(): Mastra {
    if (!runtime) {
        const directory = join(STORAGE_DIR, 'mastra');
        mkdirSync(directory, { recursive: true });
        const storage = new LibSQLStore({
            id: 'tonarice-mastra-runtime',
            url: pathToFileURL(join(directory, 'runtime.db')).href
        });
        shutdownController = new AbortController();
        const signal = shutdownController.signal;
        const coworkRepository = new CoWorkRepository(getDB());
        const coworkAgent = createCoWorkAgent(shutdownController.signal);
        runtime = new Mastra({
            agents: {
                [MASCOT_AGENT_ID]: createMascotAgent(),
                [coworkAgent.id]: coworkAgent
            },
            storage,
            scheduler: {
                enabled: true,
                onError: (_error, { scheduleId }) => {
                    const current = runtime;
                    if (current) {
                        void import('../cowork/mastra-schedules')
                            .then(({ recoverCoWorkSchedulePublication }) => recoverCoWorkSchedulePublication(current, coworkRepository, scheduleId, signal))
                            .catch(() => console.warn('[CoWork] Mastra schedule の再試行を設定できませんでした。'));
                    }
                }
            },
            schedules: createCoWorkScheduleHooks(coworkRepository, signal)
        });
    }
    return runtime;
}

/**
 * ヘルスチェック用に、初期化を発生させず現在状態を返す。
 */
export function getMastraRuntimeStatus(): MastraRuntimeStatus {
    return {
        enabled: true,
        initialized: runtime !== null
    };
}

/**
 * テスト間で遅延初期化状態を分離する。
 */
export function resetMastraRuntimeForTest(): void {
    runtime = null;
    shutdownController = undefined;
}

export function stopMastraRuntime(): void {
    shutdownController?.abort();
}

export function getMastraShutdownSignal(): AbortSignal {
    getMastraRuntime();
    return shutdownController!.signal;
}
