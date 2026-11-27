import { defineEventHandler, getRouterParam, sendNoContent } from 'h3';
import { requireCoWorkUser, requireJson, requireTask } from '../../../cowork/http';
import { deleteCoWorkTask } from '../../../cowork/runtime';

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    requireJson(event);
    requireTask(await deleteCoWorkTask(owner, getRouterParam(event, 'id') ?? ''));
    return sendNoContent(event);
});
