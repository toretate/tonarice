import { randomUUID } from 'node:crypto';

type ApprovalPeer = { send: (message: string) => void };
type PendingApproval = { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> };
const pending = new WeakMap<object, Map<string, PendingApproval>>();

/** 同じ接続だけが承認でき、切断・時間切れでは必ず拒否する。 */
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
            resolve(approved);
        };
        const onAbort = () => finish(false);
        requests.set(id, { resolve: finish, timer: setTimeout(() => finish(false), 45000) });
        signal.addEventListener('abort', onAbort, { once: true });
        try {
            peer.send(JSON.stringify({ event: 'tool-approval-request', data: { id, name, input } }));
        } catch {
            finish(false);
        }
    });
}

export function respondToolApproval(peer: object, id: unknown, approved: unknown): void {
    if (typeof id !== 'string') return;
    pending.get(peer)?.get(id)?.resolve(approved === true);
}
