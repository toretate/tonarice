import { defineEventHandler } from 'h3';
import { getCoWorkAiSettings } from '../../cowork/ai-settings';
import { requireCoWorkUser } from '../../cowork/http';

export default defineEventHandler(event => {
    const owner = requireCoWorkUser(event);
    return getCoWorkAiSettings(owner);
});
