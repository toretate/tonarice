export interface CoWorkDesktopRequest {
    method: string;
    path: string;
    body?: string;
    scope?: string;
}

export interface CoWorkDesktopResponse {
    status: number;
    data?: unknown;
}

export const coworkImportMaxBytes = 16 * 1024 * 1024;
