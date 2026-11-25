import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { safeWriteFileSync } from './fs-helpers';

export function applyMascotCliSettings(dir: string, mascot: any): any {
    const file = path.join(dir, 'config.yaml');
    if (!fs.existsSync(file)) return mascot;
    const config = yaml.load(fs.readFileSync(file, 'utf8')) as any;
    if (!config || typeof config !== 'object' || Array.isArray(config) || (config.chat !== undefined && (!config.chat || typeof config.chat !== 'object' || Array.isArray(config.chat)))) throw new Error('マスコット設定の形式が不正です。');
    return {
        ...mascot,
        ...(typeof config.profile === 'string' ? { profile: config.profile } : {}),
        aiConfig: { ...mascot.aiConfig, chat: { ...mascot.aiConfig?.chat, ...config.chat } }
    };
}

export function saveMascotCliSettings(dir: string, mascot: any): void {
    const file = path.join(dir, 'config.yaml');
    const existing = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) : {};
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('マスコット設定の形式が不正です。');
    safeWriteFileSync(file, yaml.dump({ ...existing, profile: mascot.profile || '', chat: mascot.aiConfig?.chat || {} }, { noRefs: true, lineWidth: -1 }));
}
