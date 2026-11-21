import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationBudget } from '../generation-budget';

afterEach(() => vi.useRealTimers());

describe('GenerationBudget', () => {
    it('waitForApproval_並行した承認待ちを除いて生成時間を計測すること', async () => {
        vi.useFakeTimers();
        const budget = new GenerationBudget(undefined, 1000);
        let approveFirst!: () => void;
        let approveSecond!: () => void;
        await vi.advanceTimersByTimeAsync(400);
        const first = budget.waitForApproval(() => new Promise<void>(resolve => { approveFirst = resolve; }));
        const second = budget.waitForApproval(() => new Promise<void>(resolve => { approveSecond = resolve; }));
        await vi.advanceTimersByTimeAsync(10000);
        approveFirst();
        await first;
        await vi.advanceTimersByTimeAsync(10000);
        expect(budget.signal.aborted).toBe(false);
        approveSecond();
        await second;
        await vi.advanceTimersByTimeAsync(599);
        expect(budget.signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(budget.signal.reason.name).toBe('TimeoutError');
        budget.dispose();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waitForApproval_承認待ち中の切断後は遅い承認でも継続しないこと', async () => {
        const parent = new AbortController();
        const budget = new GenerationBudget(parent.signal);
        let approve!: () => void;
        const pending = budget.waitForApproval(() => new Promise<void>(resolve => { approve = resolve; }));
        parent.abort();
        approve();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        budget.dispose();
    });
});
