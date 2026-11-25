import { defineEventHandler } from 'h3';
import { coworkImportMaxBytes } from '../../../types/cowork-desktop';
import { readCoWorkBody, requireCoWorkUser } from '../../cowork/http';
import { legacyStoreSchema } from '../../cowork/legacy-import';
import { getCoWorkRepository } from '../../cowork/runtime';

export default defineEventHandler(async event => {
    const owner = requireCoWorkUser(event);
    const source = await readCoWorkBody(event, legacyStoreSchema, coworkImportMaxBytes);
    return getCoWorkRepository().importLegacy(owner, source);
});
