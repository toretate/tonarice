import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3';
import { requireCoWorkUser, requireJson, requireTask } from '../../../../cowork/http';
import { getCoWorkRepository } from '../../../../cowork/runtime';

export default defineEventHandler(event => {
    const owner = requireCoWorkUser(event);
    requireJson(event);
    const run = requireTask(getCoWorkRepository().enqueue(owner, getRouterParam(event, 'id') ?? ''));
    setResponseStatus(event, 202);
    return run;
});
