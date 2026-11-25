import { defineEventHandler, createError, readBody } from 'h3';
import { saveTasksToDb } from '../utils/tasks-service';
import { DataRevisionConflictError } from '../utils/revision-conflict';

export default defineEventHandler(async (event) => {
    try {
        if (!event.context.user) {
            throw createError({
                statusCode: 401,
                statusMessage: '認証情報が見つかりません。'
            });
        }

        const userId = event.context.user.id;
        const body = await readBody(event);
        const {
            categories,
            tasks,
            enableNotification,
            notificationMinutes,
            completionGraceSeconds,
            defaultDurationHours,
            muteNotificationsDuringMeetings,
            baseRevision
        } = body || {};

        if (
            typeof baseRevision !== 'number'
            || !Number.isSafeInteger(baseRevision)
            || baseRevision < 0
        ) {
            throw createError({
                statusCode: 400,
                statusMessage: 'baseRevision は 0 以上の整数で指定してください。'
            });
        }

        const parsedDefaultDurationHours = Number(defaultDurationHours);

        const dataToSave = {
            categories: categories || [],
            tasks: tasks || [],
            enableNotification: enableNotification !== undefined ? enableNotification : true,
            notificationMinutes: notificationMinutes !== undefined ? notificationMinutes : 5,
            completionGraceSeconds: completionGraceSeconds !== undefined ? completionGraceSeconds : 5,
            defaultDurationHours: Number.isFinite(parsedDefaultDurationHours) && parsedDefaultDurationHours > 0
                ? parsedDefaultDurationHours
                : 1,
            muteNotificationsDuringMeetings: !!muteNotificationsDuringMeetings
        };

        const saved = saveTasksToDb(userId, dataToSave, { baseRevision });

        return { success: true, revision: saved.revision };
    } catch (error: any) {
        if (error instanceof DataRevisionConflictError) {
            throw createError({
                statusCode: 409,
                statusMessage: error.message,
                data: {
                    conflict: true,
                    currentRevision: error.currentRevision,
                    ...(error.latestData as Record<string, unknown>)
                }
            });
        }
        if (error?.statusCode) throw error;
        console.error('[Server] Failed to save tasks:', error.message);
        throw createError({
            statusCode: 500,
            statusMessage: error.message
        });
    }
});
