import { createError, getHeader, getRequestURL, type H3Event } from 'h3';
import { z } from 'zod';
import { coworkAiEngines } from '../../types/cowork-ai-settings';

export const coWorkAiSettingsSchema = z.strictObject({
    engine: z.enum(coworkAiEngines),
    model: z.string().trim().min(1).max(256)
});

export function requireCoWorkSettingsWrite(event: H3Event) {
    const origin = getHeader(event, 'origin');
    if (origin && origin !== getRequestURL(event).origin) {
        throw createError({ statusCode: 403 });
    }
    if (!getHeader(event, 'x-cowork-scope')) throw createError({ statusCode: 403 });
}
