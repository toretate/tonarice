import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3';
import { requireCoWorkUser, requireJson, requireTask } from '../../../../cowork/http';
import { runCoWorkTask } from '../../../../cowork/runtime';

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    requireJson(event);
    const run = requireTask(await runCoWorkTask(owner, getRouterParam(event, 'id') ?? ''));
    setResponseStatus(event, 202);
    return run;
});
