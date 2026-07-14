export interface MascotImageUrlOptions {
    serverHost: string;
    serverPort: number;
    absoluteMascotUrl?: boolean;
}

/**
 * 永続化済みのマスコット画像パスを描画用URLへ変換する。
 * アセット単位の版数はpath自身の?v=を使用し、グローバル版数は付与しない。
 */
export function resolveMascotImageUrl(
    path: string | undefined | null,
    options: MascotImageUrlOptions
): string {
    if (!path) return '';
    if (path.startsWith('data:image/') || path.startsWith('blob:')) return path;

    if (path.startsWith('/mascots/') && options.absoluteMascotUrl) {
        return `http://${options.serverHost}:${options.serverPort}${path}`;
    }

    return path;
}
