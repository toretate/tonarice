/**
 * Base64 または Data URL 形式の画像（PNG, JPEG, WebP）から Stable Diffusion の生成プロンプトを抽出する
 */
export function extractImagePrompt(dataUrl: string): string {
    const fullParams = extractImageParameters(dataUrl);
    if (!fullParams) return '';
    return parsePromptFromParameters(fullParams);
}

/**
 * Base64 または Data URL 形式の画像（PNG, JPEG, WebP）から Stable Diffusion の生成パラメータ（全体の文字列）を抽出する
 */
export function extractImageParameters(dataUrl: string): string {
    let base64 = dataUrl;
    if (dataUrl.startsWith('data:')) {
        const parts = dataUrl.split(',');
        if (parts[1]) {
            base64 = parts[1];
        }
    }

    try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // 1. PNG独自の高速チャンク解析を試みる
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
            const pngParams = parsePngChunksFull(bytes);
            if (pngParams) return pngParams;
        }

        // 2. PNG解析で取得できなかった場合、または JPEG / WebP の場合はバイナリスキャンを試みる
        return scanParametersFromBinaryFull(bytes);

    } catch (e) {
        console.error('[Metadata Parser] Failed to parse image metadata:', e);
    }
    return '';
}

function parsePngChunksFull(bytes: Uint8Array): string {
    try {
        let pos = 8;
        while (pos < bytes.length) {
            if (pos + 8 > bytes.length) break;
            const length = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
            const typeBytes = bytes.slice(pos + 4, pos + 8);
            const type = String.fromCharCode(...typeBytes);
            const chunkDataPos = pos + 8;
            if (chunkDataPos + length > bytes.length) break;

            if (type === 'tEXt') {
                const chunkData = bytes.slice(chunkDataPos, chunkDataPos + length);
                const nullIndex = chunkData.indexOf(0x00);
                if (nullIndex !== -1) {
                    const keyword = String.fromCharCode(...chunkData.slice(0, nullIndex));
                    if (keyword === 'parameters') {
                        const textBytes = chunkData.slice(nullIndex + 1);
                        const decoder = new TextDecoder('utf-8');
                        return decoder.decode(textBytes);
                    }
                }
            } else if (type === 'iTXt') {
                const chunkData = bytes.slice(chunkDataPos, chunkDataPos + length);
                const nullIndex = chunkData.indexOf(0x00);
                if (nullIndex !== -1) {
                    const keyword = String.fromCharCode(...chunkData.slice(0, nullIndex));
                    if (keyword === 'parameters') {
                        const compressionFlag = chunkData[nullIndex + 1];
                        let langIndex = chunkData.indexOf(0x00, nullIndex + 3);
                        if (langIndex !== -1) {
                            let transIndex = chunkData.indexOf(0x00, langIndex + 1);
                            if (transIndex !== -1) {
                                const textBytes = chunkData.slice(transIndex + 1);
                                if (compressionFlag === 0) {
                                    const decoder = new TextDecoder('utf-8');
                                    return decoder.decode(textBytes);
                                }
                            }
                        }
                    }
                }
            } else if (type === 'IEND') {
                break;
            }
            pos += 4 + 4 + length + 4;
        }
    } catch {}
    return '';
}

function scanParametersFromBinaryFull(bytes: Uint8Array): string {
    try {
        // 先頭 256KB のみスキャンしてパフォーマンスを確保
        const scanLimit = Math.min(bytes.length, 256 * 1024);
        const slice = bytes.slice(0, scanLimit);
        
        // Latin-1 デコードでバイナリを1対1で文字列表現にする
        const decoder = new TextDecoder('iso-8859-1');
        const text = decoder.decode(slice);
        
        const stepsIndex = text.indexOf('Steps: ');
        const negIndex = text.indexOf('Negative prompt: ');
        
        if (stepsIndex === -1 && negIndex === -1) {
            return '';
        }
        
        const targetIndex = negIndex !== -1 ? negIndex : stepsIndex;
        const startSearch = Math.max(0, targetIndex - 2000);
        const chunk = text.substring(startSearch, targetIndex);
        
        let promptStart = 0;
        const lastNull = chunk.lastIndexOf('\x00');
        if (lastNull !== -1) {
            promptStart = startSearch + lastNull + 1;
        } else {
            const lastTagEnd = chunk.lastIndexOf('>');
            if (lastTagEnd !== -1) {
                promptStart = startSearch + lastTagEnd + 1;
            } else {
                promptStart = startSearch;
            }
        }

        // パラメータ最終行 (Steps: ...) の末尾を特定する
        let stepsLineEnd = text.indexOf('\n', stepsIndex);
        if (stepsLineEnd === -1) {
            stepsLineEnd = text.indexOf('\r', stepsIndex);
        }
        if (stepsLineEnd === -1) {
            stepsLineEnd = text.length;
        }
        
        let fullParams = text.substring(promptStart, stepsLineEnd).trim();
        fullParams = cleanPromptText(fullParams);
        return fullParams;

    } catch (e) {
        console.error('[Metadata Scanner] Scan failed:', e);
    }
    return '';
}

function cleanPromptText(text: string): string {
    // 先頭の制御文字やゴミデータを削除（UTF-8文字の崩れ等）
    let cleaned = text.replace(/^[\s\x00-\x1F\x7F-\x9F]+/, '');
    
    // Exifのエンコーディング定義部分、またはカスタムチャンクヘッダー等が残っていれば除去
    cleaned = cleaned.replace(/^(UNICODE|ASCII|para|tEXt)[\s\x00]*/i, '');
    
    // 制御コードが一部混ざっている場合の除去
    cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
    
    return cleaned.trim();
}

function parsePromptFromParameters(params: string): string {
    if (!params) return '';
    const lines = params.split('\n');
    const promptLines: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('Negative prompt:') || trimmed.startsWith('Steps:')) {
            break;
        }
        promptLines.push(line);
    }
    return promptLines.join('\n').trim();
}
