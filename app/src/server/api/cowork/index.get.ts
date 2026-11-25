import { defineEventHandler } from 'h3';
import { getCoWorkScope, requireCoWorkUser } from '../../cowork/http';
import { getCoWorkRepository } from '../../cowork/runtime';

export default defineEventHandler(event => {
    const owner = requireCoWorkUser(event);
    return {
        ...getCoWorkRepository().list(owner),
        scope: getCoWorkScope(owner),
        account: event.context.user.email || owner
    };
});
