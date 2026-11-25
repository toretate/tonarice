import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyMascotCliSettings, saveMascotCliSettings } from '../utils/mascot-cli-settings';

const directories: string[] = [];
function createDirectory() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tonarice-mascot-test-'));
    directories.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('マスコット設定の互換性', () => {
    it('applyMascotCliSettings_YAMLがない既存設定をそのまま返す', () => {
        const mascot = { id: 'a', profile: '元の性格' };
        expect(applyMascotCliSettings(createDirectory(), mascot)).toEqual(mascot);
    });

    it('saveMascotCliSettings_既存の他の設定を保って保存し読み戻す', () => {
        const dir = createDirectory();
        fs.writeFileSync(path.join(dir, 'config.yaml'), 'other: 保持\n', 'utf8');
        const mascot = { id: 'a', profile: '明るい', aiConfig: { chat: { engine: 'openai', model: 'model-a' }, voice: { engine: 'voicevox' } } };
        saveMascotCliSettings(dir, mascot);
        expect(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')).toContain('other: 保持');
        expect(applyMascotCliSettings(dir, { id: 'a', profile: '旧設定', aiConfig: { voice: { engine: 'voicevox' } } })).toEqual(mascot);
    });

    it('applyMascotCliSettings_不正なYAMLを既定値として扱わない', () => {
        const dir = createDirectory();
        fs.writeFileSync(path.join(dir, 'config.yaml'), 'chat: []\n', 'utf8');
        expect(() => applyMascotCliSettings(dir, {})).toThrow();
    });
});
