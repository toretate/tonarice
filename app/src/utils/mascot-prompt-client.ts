export type MascotPrompts = Awaited<ReturnType<NonNullable<Window['electronAPI']>['getMascotPrompts']>>;

export async function loadMascotPrompts(mascotId: string): Promise<{ prompts: MascotPrompts; configured: boolean }> {
    const query = new URLSearchParams({ mascotId });
    const response = await fetch('/api/mascots/cli-prompts?' + query, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('サーバーからプロンプトを取得できませんでした。');
    const data = await response.json();
    if (!data?.success || typeof data.configured !== 'boolean' || !data.prompts) {
        throw new Error('プロンプトの応答が不正です。');
    }
    return data;
}

export async function saveMascotPrompts(mascotId: string, prompts: MascotPrompts): Promise<void> {
    const response = await fetch('/api/mascots/cli-prompts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mascotId, prompts })
    });
    if (!response.ok) throw new Error('サーバーにプロンプトを保存できませんでした。');
}
