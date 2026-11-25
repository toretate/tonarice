import { defineEventHandler, setResponseStatus } from 'h3';
import { scheduledPromptTaskInputSchema } from '../../../../types/scheduled-prompt-task';
import { readCoWorkBody, requireCoWorkUser } from '../../../cowork/http';
import { getCoWorkRepository } from '../../../cowork/runtime';

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    const input = await readCoWorkBody(event, scheduledPromptTaskInputSchema);
    const task = getCoWorkRepository().create(owner, input);
    setResponseStatus(event, 201);
    return task;
});
