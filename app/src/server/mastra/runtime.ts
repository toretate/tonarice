import { Mastra } from '@mastra/core/mastra';
import { createMascotAgent, MASCOT_AGENT_ID } from './mascot-agent';

let runtime: Mastra | null = null;

export interface MastraRuntimeStatus {
    enabled: boolean;
    initialized: boolean;
}

/**
 * Nitroプロセス内でMastraランタイムを遅延初期化する。
 */
export function getMastraRuntime(): Mastra {
    if (!runtime) {
        runtime = new Mastra({
            agents: {
                [MASCOT_AGENT_ID]: createMascotAgent()
            }
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
}
