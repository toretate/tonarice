import { afterEach, describe, expect, it } from 'vitest';
import {
    getMastraRuntime,
    getMastraRuntimeStatus,
    resetMastraRuntimeForTest
} from '../runtime';

describe('getMastraRuntimeのテスト', () => {
    afterEach(() => {
        resetMastraRuntimeForTest();
    });

    it('getMastraRuntime_最初の利用まで初期化せず同じインスタンスを再利用すること', () => {
        expect(getMastraRuntimeStatus().initialized).toBe(false);

        const first = getMastraRuntime();
        const second = getMastraRuntime();

        expect(first).toBe(second);
        expect(getMastraRuntimeStatus().initialized).toBe(true);
    });
});
