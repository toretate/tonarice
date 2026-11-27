import { defineEventHandler } from 'h3';
import { getCoWorkAiSettings, resetCoWorkAiSettings } from '../../cowork/ai-settings';
import { requireCoWorkUser, requireJson } from '../../cowork/http';
import { requireCoWorkSettingsWrite } from '../../cowork/settings-http';

export default defineEventHandler(event => {
    const owner = requireCoWorkUser(event);
    requireCoWorkSettingsWrite(event);
    requireJson(event);
    resetCoWorkAiSettings(owner);
    return getCoWorkAiSettings(owner);
});
