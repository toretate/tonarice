import { createError, defineEventHandler, setHeader } from 'h3';
import { z } from 'zod';
import { readCoWorkBody, requireSecurePairing } from '../../../cowork/http';
import { claimCoWorkPairingCode } from '../../../cowork/pairing';

const schema = z.strictObject({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export default defineEventHandler(async event => {
    setHeader(event, 'Cache-Control', 'no-store');
    requireSecurePairing(event);
    const { code } = await readCoWorkBody(event, schema, 512);
    const result = claimCoWorkPairingCode(code);
    if (!result) throw createError({ statusCode: 401, message: '接続コードが無効か、期限切れです。' });
    return result;
});
