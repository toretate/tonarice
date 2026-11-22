import { afterEach, describe, expect, it, vi } from 'vitest';
import { MASCOT_AGENT_ID, MASCOT_AGENT_PROFILE } from '../mascot-agent-profile';

describe('Mastra Studio', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('mastra_ループバックでツールなしのマスコットエージェントを公開すること', async () => {
        vi.stubEnv('MASTRA_STUDIO_LMSTUDIO_MODEL', undefined);

        const { mastra } = await import('../studio');
        const agent = mastra.getAgentById(MASCOT_AGENT_ID);

        expect(mastra.getServer()).toMatchObject({ host: '127.0.0.1', port: 4111 });
        expect(agent.name).toBe(MASCOT_AGENT_PROFILE.name);
        expect(await agent.listTools()).toEqual({});
    });

    it('mastra_LM Studioのモデル識別子に含まれるスラッシュを維持すること', async () => {
        vi.stubEnv('MASTRA_STUDIO_LMSTUDIO_MODEL', 'publisher/model');

        const { mastra } = await import('../studio');
        const model = await mastra.getAgentById(MASCOT_AGENT_ID).getModel();

        expect(model.modelId).toBe('publisher/model');
    });
});
