/** 承認待ちを除く生成時間を制限し、切断は待機中も即座に反映する。 */
export class GenerationBudget {
    private readonly controller = new AbortController();
    private timer?: ReturnType<typeof setTimeout>;
    private remaining: number;
    private startedAt = 0;
    private waiters = 0;
    private disposed = false;
    private readonly onAbort = () => this.controller.abort(this.parentSignal?.reason);

    constructor(private readonly parentSignal?: AbortSignal, timeoutMs = 60000) {
        this.remaining = timeoutMs;
        if (parentSignal?.aborted) this.onAbort();
        else parentSignal?.addEventListener('abort', this.onAbort, { once: true });
        this.resume();
    }

    get signal(): AbortSignal { return this.controller.signal; }

    private resume(): void {
        if (this.disposed || this.signal.aborted || this.waiters > 0) return;
        this.startedAt = performance.now();
        this.timer = setTimeout(() => {
            this.controller.abort(new DOMException('生成時間を超過しました。', 'TimeoutError'));
        }, Math.max(0, this.remaining));
    }

    async waitForApproval<T>(wait: () => Promise<T>): Promise<T> {
        this.signal.throwIfAborted();
        if (this.waiters++ === 0) {
            clearTimeout(this.timer);
            this.remaining -= performance.now() - this.startedAt;
            if (this.remaining <= 0) {
                this.controller.abort(new DOMException('生成時間を超過しました。', 'TimeoutError'));
            }
        }
        try {
            this.signal.throwIfAborted();
            const result = await wait();
            this.signal.throwIfAborted();
            return result;
        } finally {
            this.waiters--;
            if (this.waiters === 0) this.resume();
        }
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
        this.controller.abort(new DOMException('処理が終了しました。', 'AbortError'));
        this.parentSignal?.removeEventListener('abort', this.onAbort);
    }
}
