import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { MASCOT_AGENT_ID, MASCOT_AGENT_PROFILE } from '../mascot-agent-profile';
import { normalizeLmStudioBaseUrl } from '../../utils/lmstudio-fetch';

const localModelId = process.env.MASTRA_STUDIO_LMSTUDIO_MODEL?.trim();
const model = localModelId
    ? {
        id: `lmstudio/${localModelId}` as const,
        url: normalizeLmStudioBaseUrl(process.env.MASTRA_STUDIO_LMSTUDIO_ENDPOINT),
        apiKey: 'not-needed',
        api: 'chat' as const
    }
    : 'google/gemini-3.5-flash-lite';

export const mastra = new Mastra({
    agents: { [MASCOT_AGENT_ID]: new Agent({ ...MASCOT_AGENT_PROFILE, model }) },
    server: { host: '127.0.0.1', port: 4111 }
});
