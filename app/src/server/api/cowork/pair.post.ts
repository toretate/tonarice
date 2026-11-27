import { defineEventHandler } from 'h3';
import { requireCoWorkUser, requireJson, requireSecurePairing } from '../../cowork/http';
import { createCoWorkPairingCode } from '../../cowork/pairing';

export default defineEventHandler(event => {
    const owner = requireCoWorkUser(event);
    requireSecurePairing(event);
    requireJson(event);
    return createCoWorkPairingCode(owner);
});
