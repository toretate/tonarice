const userConnections = new Map<string, Set<{ send: (payload: string) => void }>>();

export function addUserConnection(userId: string, peer: { send: (payload: string) => void }): void {
    if (!userConnections.has(userId)) userConnections.set(userId, new Set());
    userConnections.get(userId)!.add(peer);
}

export function removeUserConnection(userId: string, peer: { send: (payload: string) => void }): void {
    const peers = userConnections.get(userId);
    peers?.delete(peer);
    if (peers?.size === 0) userConnections.delete(userId);
}

export function broadcastToUser(userId: string, event: string, data: unknown): void {
    const payload = JSON.stringify({ event, data });
    for (const peer of userConnections.get(userId) || []) {
        try { peer.send(payload); } catch { /* 切断済み接続は次の操作を妨げない。 */ }
    }
}

const sessionConnections = new Map<string, Set<() => void>>();

export function trackSessionConnection(sessionId: string, disconnect: () => void): () => void {
    const connections = sessionConnections.get(sessionId) ?? new Set<() => void>();
    sessionConnections.set(sessionId, connections);
    connections.add(disconnect);
    return () => {
        connections.delete(disconnect);
        if (connections.size === 0 && sessionConnections.get(sessionId) === connections) {
            sessionConnections.delete(sessionId);
        }
    };
}

export function disconnectSession(sessionId: string): void {
    const connections = sessionConnections.get(sessionId);
    sessionConnections.delete(sessionId);
    for (const disconnect of connections ?? []) disconnect();
}
