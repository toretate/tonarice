import { randomUUID } from 'node:crypto';

type ApprovalPeer = { send: (message: string) => void };
type PendingApproval = { resolve: (approved: boolean) => void; start: () => void; timer?: ReturnType<typeof setTimeout> };
const pending = new WeakMap<object, Map<string, PendingApproval>>();

/** 接続ごとに承認画面を直列化し、表示開始から期限を計測する。 */
export function requestToolApproval(peer: ApprovalPeer, name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise(resolve => {
        const requests = pending.get(peer) || new Map<string, PendingApproval>();
        pending.set(peer, requests);
        const finish = (approved: boolean) => {
            const request = requests.get(id);
            if (!request) return;
            clearTimeout(request.timer);
            requests.delete(id);
            signal.removeEventListener('abort', onAbort);
            try {
                peer.send(JSON.stringify({ event: 'tool-approval-finished', data: { id } }));
            } catch { /* 切断済みの接続への通知は不要。 */ }
            resolve(approved);
            requests.values().next().value?.start();
        };
        const onAbort = () => finish(false);
        const request: PendingApproval = {
            resolve: finish,
            start: () => {
                if (request.timer !== undefined) return;
                if (signal.aborted) { finish(false); return; }
                request.timer = setTimeout(() => finish(false), 45000);
                try {
                    peer.send(JSON.stringify({ event: 'tool-approval-request', data: { id, name, input } }));
                } catch { finish(false); }
            }
        };
        requests.set(id, request);
        signal.addEventListener('abort', onAbort, { once: true });
        requests.values().next().value?.start();
    });
}

export function respondToolApproval(peer: object, id: unknown, approved: unknown): void {
    if (typeof id !== 'string') return;
    const request = pending.get(peer)?.get(id);
    if (request?.timer !== undefined) request.resolve(approved === true);
}
