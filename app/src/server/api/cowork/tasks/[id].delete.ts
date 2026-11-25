import { defineEventHandler, getRouterParam, sendNoContent } from 'h3';
import { requireCoWorkUser, requireJson, requireTask } from '../../../cowork/http';
import { getCoWorkRepository } from '../../../cowork/runtime';

export default defineEventHandler(event => {
    const owner = requireCoWorkUser(event);
    requireJson(event);
    requireTask(getCoWorkRepository().delete(owner, getRouterParam(event, 'id') ?? ''));
    return sendNoContent(event);
});
