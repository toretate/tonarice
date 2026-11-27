import { defineEventHandler } from 'h3';
import { z } from 'zod';
import { coworkAiEngines } from '../../../types/cowork-ai-settings';
import { readCoWorkBody, requireCoWorkUser } from '../../cowork/http';
import { getCoWorkModelCatalog } from '../../cowork/model-catalog';
import { requireCoWorkSettingsWrite } from '../../cowork/settings-http';

const schema = z.strictObject({ engine: z.enum(coworkAiEngines) });

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    requireCoWorkSettingsWrite(event);
    const { engine } = await readCoWorkBody(event, schema, 1024, 'AI サービスを選んでください。');
    return getCoWorkModelCatalog(owner, engine);
});
