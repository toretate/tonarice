import { join } from 'node:path';
import { USERS_DIR } from './paths';

export function getUserConfigPath(userId: string) {
    return join(USERS_DIR, userId, 'user_config.json');
}
