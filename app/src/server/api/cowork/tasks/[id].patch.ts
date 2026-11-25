import { defineEventHandler, getRouterParam } from 'h3';
import { z } from 'zod';
import { scheduledPromptTaskInputSchema } from '../../../../types/scheduled-prompt-task';
import { readCoWorkBody, requireCoWorkUser, requireTask } from '../../../cowork/http';
import { getCoWorkRepository } from '../../../cowork/runtime';

const updateSchema = z.union([scheduledPromptTaskInputSchema, z.strictObject({ enabled: z.boolean() })]);

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    const input = await readCoWorkBody(event, updateSchema);
    return requireTask(getCoWorkRepository().update(owner, getRouterParam(event, 'id') ?? '', input));
});
