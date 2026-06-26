import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, defaultData } from '../app-config';

// Electron モジュールをモック化
const mockUserDataPath = path.resolve(__dirname, './tmp-config-test');
vi.mock('electron', () => {
    return {
        app: {
            isPackaged: true,
            setName: vi.fn(),
            getPath: vi.fn(() => mockUserDataPath)
        }
    };
});

describe('AppConfig クラスのテスト', () => {
    const configPath = path.join(mockUserDataPath, 'config.json');
    const backupPath = configPath + '.bak';

    beforeEach(() => {
        if (!fs.existsSync(mockUserDataPath)) {
            fs.mkdirSync(mockUserDataPath, { recursive: true });
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        if (fs.existsSync(configPath + '.tmp')) fs.unlinkSync(configPath + '.tmp');
        if (fs.existsSync(backupPath + '.tmp')) fs.unlinkSync(backupPath + '.tmp');
        if (fs.existsSync(mockUserDataPath)) fs.rmdirSync(mockUserDataPath);
    });

    it('初回ロード時に config.json が存在しない場合、デフォルト値が返されること', () => {
        const config = new AppConfig();
        expect(config.get()).toEqual(defaultData);
        expect(fs.existsSync(configPath)).toBe(false);
    });

    it('update を呼び出した際、アトミックにファイルが書き込まれ、バックアップも作成されること', () => {
        const config = new AppConfig();
        config.update({ openaiApiKey: 'test-key' });

        expect(config.get().openaiApiKey).toBe('test-key');
        
        // ファイルに正しく書き込まれているか確認
        expect(fs.existsSync(configPath)).toBe(true);
        const savedData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(savedData.openaiApiKey).toBe('test-key');

        // 次回ロードされると、正常にロードされてバックアップも生成されることを確認
        const config2 = new AppConfig();
        expect(config2.get().openaiApiKey).toBe('test-key');
        expect(fs.existsSync(backupPath)).toBe(true);
        const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        expect(backupData.openaiApiKey).toBe('test-key');
    });

    it('メインの config.json が破損していても、バックアップファイルが正常ならバックアップから自動復元されること', () => {
        // 1. 正常な状態を作って一度保存し、バックアップを作成させる
        const config = new AppConfig();
        config.update({ openaiApiKey: 'restored-key' });
        
        // バックアップを作成させるために一度ロードを挟む
        new AppConfig();
        expect(fs.existsSync(backupPath)).toBe(true);

        // 2. メインの config.json を破損させる（空にする）
        fs.writeFileSync(configPath, '', 'utf8');

        // 3. 再ロード
        const config2 = new AppConfig();
        
        // バックアップから値が復元されていること
        expect(config2.get().openaiApiKey).toBe('restored-key');
        // メインの config.json 自体も復元されていること
        const repairedData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(repairedData.openaiApiKey).toBe('restored-key');
    });

    it('メインおよびバックアップの双方が破損している場合、デフォルト値で起動し、読み込み専用モードとなって上書き保存が抑止されること', () => {
        // 1. 両方のファイルを破損させる
        fs.writeFileSync(configPath, '{ invalid json', 'utf8');
        fs.writeFileSync(backupPath, '', 'utf8');

        // 2. ロード
        const config = new AppConfig();
        
        // デフォルト値が返されること
        expect(config.get()).toEqual(defaultData);

        // 3. 設定変更の update を呼び出す
        config.update({ openaiApiKey: 'new-key' });

        // 読み込み専用モードのため、メモリ上の値は変わる可能性があるが、ファイルに書き込まれていないことを確認
        const rawContent = fs.readFileSync(configPath, 'utf8');
        expect(rawContent).toBe('{ invalid json'); // 破損した状態のままで、上書きされていない
    });

    it('update 時、mascots 配列が設定データから除外されてローカルファイルに保存されること', () => {
        const config = new AppConfig();
        
        // update に mascots を含めて呼び出す
        config.update({
            openaiApiKey: 'has-api-key',
            mascots: [{ id: 'mascot_1', name: 'マスコット1' } as any]
        });

        // ファイルに保存された設定から mascots が除外されていることを検証
        expect(fs.existsSync(configPath)).toBe(true);
        const fileContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        expect(fileContent.openaiApiKey).toBe('has-api-key');
        expect(fileContent.mascots).toBeUndefined(); // 除外されていること
    });
});
