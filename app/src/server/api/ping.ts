import { defineEventHandler } from 'h3';
import { getMastraRuntimeStatus } from '../mastra/runtime';

export default defineEventHandler((event) => {
    console.log('[Server] Ping request received');
    return {
        success: true,
        message: 'pong',
        timestamp: new Date().toISOString(),
        mastra: getMastraRuntimeStatus()
    };
});
