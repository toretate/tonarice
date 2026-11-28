interface CompanionState {
    enabled: boolean;
    concerns: { id: string; text: string; expiresAt?: number }[];
    revision?: { id: string; timestamp: number };
    reasons: string[];
}

export async function loadCompanionMemory(mascotId: string): Promise<CompanionState> {
    const response = await fetch('/api/mascots/companion-memory?' + new URLSearchParams({ mascotId }), {
        credentials: 'include', cache: 'no-store'
    });
    if (!response.ok) throw new Error('記憶設定を読み込めませんでした。');
    return response.json();
}

export async function changeCompanionMemory(
    mascotId: string, action: { enabled: boolean } | { deleteId: string } | { undoId: string }
): Promise<CompanionState> {
    const response = await fetch('/api/mascots/companion-memory', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mascotId, ...action })
    });
    if (!response.ok) throw new Error(response.status === 409
        ? '対象箇所が編集済みのため、更新を元に戻せませんでした。' : '記憶設定を更新できませんでした。');
    return response.json();
}
