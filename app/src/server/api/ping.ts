import { defineEventHandler } from 'h3';
import { getMastraRuntimeStatus } from '../mastra/runtime';

export default defineEventHandler((event) => {
    console.log('[Server] Ping request received');
    return {
        success: true,
        message: 'pong',
        isolated: process.env.TONARICE_ISOLATED_SERVER === '1',
        timestamp: new Date().toISOString(),
        mastra: getMastraRuntimeStatus()
    };
});
