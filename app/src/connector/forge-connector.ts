export interface ForgeGenerateParams {
    prompt: string;
    negativePrompt?: string;
    steps?: number;
    width?: number;
    height?: number;
    cfgScale?: number;
    samplerName?: string;
    modelCheckpoint?: string;
    initImage?: string; // i2i用の元画像 (Base64データ、data:image/png;base64,...プレフィックスは除いた純粋なデータ)
    denoisingStrength?: number; // i2i用のノイズ除去強度
}

/**
 * Stable Diffusion WebUI Forge を使用して画像を生成するコネクタ
 */
export class ForgeConnector {
    /**
     * 画像を生成する (t2i または i2i)
     * @param params 生成パラメータ
     * @param host Forgeサーバーのホスト（例: http://127.0.0.1:5555）
     * @returns 生成された画像のBase64文字列（純粋なBase64データ）
     */
    static async generateImage(params: ForgeGenerateParams, host: string = 'http://127.0.0.1:5555', debugLog: boolean = false): Promise<string> {
        const isImg2Img = !!params.initImage;
        const endpoint = isImg2Img ? 'img2img' : 'txt2img';
        const url = `${host}/sdapi/v1/${endpoint}`;
        
        const payload: any = {
            prompt: params.prompt,
            negative_prompt: params.negativePrompt || 'nsfw, low quality, worst quality, deformed, bad anatomy',
            steps: params.steps ?? 25,
            width: params.width ?? 1024,
            height: params.height ?? 1024,
            batch_size: 1,
            cfg_scale: params.cfgScale ?? 7.0,
            sampler_name: params.samplerName ?? 'Euler a',
            scheduler: 'Automatic'
        };

        if (isImg2Img) {
            // data url プレフィックスがある場合は純粋な Base64 部のみを取り出す
            let rawBase64 = params.initImage!;
            if (rawBase64.startsWith('data:')) {
                rawBase64 = rawBase64.split(',')[1] || rawBase64;
            }
            payload.init_images = [rawBase64];
            payload.denoising_strength = params.denoisingStrength ?? 0.7;
        }

        payload.override_settings = {
            samples_format: 'png'
        };
        if (params.modelCheckpoint) {
            payload.override_settings.sd_model_checkpoint = params.modelCheckpoint;
        }

        console.log(`[ForgeConnector] Sending request to ${url} ...`);
        if (debugLog) {
            const payloadCopy = { ...payload };
            if (payloadCopy.init_images && payloadCopy.init_images.length > 0) {
                payloadCopy.init_images = [`<Base64 Image Data: ${payloadCopy.init_images[0].length} chars>`];
            }
            console.log('[ForgeConnector] Request Payload:\n', JSON.stringify(payloadCopy, null, 4));
        }
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Forge API returned status ${response.status}: ${response.statusText}`);
            }

            const data = await response.json() as { images?: string[]; info?: string };
            if (!data.images || data.images.length === 0) {
                throw new Error('Forge API returned no images');
            }

            const base64Image = data.images[0];
            const paramsText = buildParametersText(params.prompt, params.negativePrompt, data.info);
            
            if (debugLog) {
                console.log('[ForgeConnector Debug] Injected Parameters Text:\n', paramsText);
            }

            let embeddedBase64 = base64Image;
            try {
                const imageBuffer = Buffer.from(base64Image, 'base64');
                if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) {
                    embeddedBase64 = writePngParametersNode(base64Image, paramsText);
                } else if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46) {
                    embeddedBase64 = writeWebpParametersNode(base64Image, paramsText);
                } else if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
                    embeddedBase64 = writeJpegParametersNode(base64Image, paramsText);
                }
            } catch (e) {
                console.error('[ForgeConnector] Failed to determine format or embed parameters:', e);
            }
            return embeddedBase64;
        } catch (error: any) {
            console.error('[ForgeConnector] Connection error:', error);
            throw new Error(`Stable Diffusion WebUI Forge との接続エラー: ${error.message}`);
        }
    }

    /**
     * サーバーの稼働状態（ヘルスチェック）を確認する
     * @param host Forgeサーバーのホスト
     * @returns 接続可能な場合は true
     */
    static async health(host: string = 'http://127.0.0.1:5555'): Promise<boolean> {
        const url = `${host}/sdapi/v1/sd-models`; // ヘルスチェック用エンドポイントとしてモデル取得を代用
        try {
            const response = await fetch(url, { method: 'GET' });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * 利用可能なモデル（チェックポイント）一覧を取得する
     * @param host Forgeサーバーのホスト
     * @returns モデル名（title）の配列。失敗時は空配列。
     */
    static async models(host: string = 'http://127.0.0.1:5555'): Promise<string[]> {
        const url = `${host}/sdapi/v1/sd-models`;
        try {
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                console.error(`[ForgeConnector] sd-models status not ok: ${response.status}`);
                return [];
            }
            const data = await response.json();
            if (!Array.isArray(data)) {
                console.error('[ForgeConnector] sd-models response is not an array:', data);
                return [];
            }
            return data.map((item: any) => {
                if (!item) return '';
                return item.title || item.model_name || item.filename || '';
            }).filter(Boolean);
        } catch (error) {
            console.error('[ForgeConnector] Failed to fetch models:', error);
            return [];
        }
    }

    /**
     * 利用可能な LoRA 一覧を取得する
     * @param host Forgeサーバーのホスト
     * @returns LoRA名（name）の配列。失敗時は空配列。
     */
    static async loras(host: string = 'http://127.0.0.1:5555'): Promise<string[]> {
        const url = `${host}/sdapi/v1/loras`;
        try {
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) return [];
            const data = await response.json() as { name: string; path?: string }[];
            return data.map(item => item.name || '').filter(Boolean);
        } catch (error) {
            console.error('[ForgeConnector] Failed to fetch loras:', error);
            return [];
        }
    }
}

function calculateCrc32(buffer: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        crc = crc ^ byte;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writePngParametersNode(base64Image: string, parametersText: string): string {
    try {
        const imageBuffer = Buffer.from(base64Image, 'base64');
        if (imageBuffer[0] !== 0x89 || imageBuffer[1] !== 0x50 || imageBuffer[2] !== 0x4E || imageBuffer[3] !== 0x47) {
            return base64Image;
        }

        const keyword = 'parameters';
        const keywordBuf = Buffer.from(keyword, 'utf8');
        const textBuf = Buffer.from(parametersText, 'utf8');
        
        const chunkData = Buffer.alloc(keywordBuf.length + 1 + textBuf.length);
        keywordBuf.copy(chunkData, 0);
        chunkData[keywordBuf.length] = 0x00;
        textBuf.copy(chunkData, keywordBuf.length + 1);

        const chunkHeader = Buffer.alloc(8);
        chunkHeader.writeUInt32BE(chunkData.length, 0);
        chunkHeader.write('tEXt', 4, 'utf8');

        const crcInput = Buffer.concat([chunkHeader.slice(4), chunkData]);
        const crc = calculateCrc32(crcInput);

        const chunkFooter = Buffer.alloc(4);
        chunkFooter.writeUInt32BE(crc, 0);

        const insertPos = 33;
        
        const newBuffer = Buffer.concat([
            imageBuffer.slice(0, insertPos),
            chunkHeader,
            chunkData,
            chunkFooter,
            imageBuffer.slice(insertPos)
        ]);

        return newBuffer.toString('base64');
    } catch (e) {
        console.error('[PNG Writer Node] Failed to embed metadata:', e);
        return base64Image;
    }
}

function buildParametersText(prompt: string, negativePrompt?: string, infoJsonStr?: string): string {
    const trimmed = infoJsonStr ? infoJsonStr.trim() : '';
    const isJson = trimmed.startsWith('{');

    // JSONでない場合にのみ、すでにプレーンテキストとしてパラメータ情報（Steps: ）が含まれているかを判定する
    if (!isJson && infoJsonStr && (infoJsonStr.includes('Steps:') || infoJsonStr.includes('Negative prompt:'))) {
        return infoJsonStr;
    }

    try {
        if (infoJsonStr) {
            const info = JSON.parse(infoJsonStr);
            let text = info.prompt || prompt;
            if (info.negative_prompt) {
                text += `\nNegative prompt: ${info.negative_prompt}`;
            } else if (negativePrompt) {
                text += `\nNegative prompt: ${negativePrompt}`;
            }
            
            const steps = info.steps ?? 25;
            const sampler = info.sampler_name ?? 'Euler a';
            const cfg = info.cfg_scale ?? 7.0;
            const seed = info.seed ?? -1;
            const width = info.width ?? 1024;
            const height = info.height ?? 1024;
            const model = info.sd_model_name || '';
            const modelHash = info.sd_model_hash || '';
            
            let extra = `Steps: ${steps}, Sampler: ${sampler}, CFG scale: ${cfg}, Seed: ${seed}, Size: ${width}x${height}`;
            if (model) extra += `, Model: ${model}`;
            if (modelHash) extra += `, Model hash: ${modelHash}`;
            text += `\n${extra}`;
            return text;
        }
    } catch (e) {
        console.warn('[Parameters Builder] Failed to parse info JSON, falling back to regex extraction:', e);
        if (infoJsonStr) {
            try {
                // JSONパースに失敗した場合の堅牢な正規表現フォールバック
                const promptMatch = infoJsonStr.match(/"prompt":\s*"((?:[^"\\]|\\.)*)"/);
                const negMatch = infoJsonStr.match(/"negative_prompt":\s*"((?:[^"\\]|\\.)*)"/);
                if (promptMatch) {
                    let text = promptMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    if (negMatch) {
                        text += `\nNegative prompt: ${negMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')}`;
                    } else if (negativePrompt) {
                        text += `\nNegative prompt: ${negativePrompt}`;
                    }
                    
                    const stepsMatch = infoJsonStr.match(/"steps":\s*(\d+)/);
                    const samplerMatch = infoJsonStr.match(/"sampler_name":\s*"([^"]+)"/);
                    const cfgMatch = infoJsonStr.match(/"cfg_scale":\s*([\d.]+)/);
                    const seedMatch = infoJsonStr.match(/"seed":\s*(\d+)/);
                    const wMatch = infoJsonStr.match(/"width":\s*(\d+)/);
                    const hMatch = infoJsonStr.match(/"height":\s*(\d+)/);
                    
                    const extraParts = [];
                    if (stepsMatch) extraParts.push(`Steps: ${stepsMatch[1]}`);
                    if (samplerMatch) extraParts.push(`Sampler: ${samplerMatch[1]}`);
                    if (cfgMatch) extraParts.push(`CFG scale: ${cfgMatch[1]}`);
                    if (seedMatch) extraParts.push(`Seed: ${seedMatch[1]}`);
                    if (wMatch && hMatch) extraParts.push(`Size: ${wMatch[1]}x${hMatch[1]}`);
                    
                    if (extraParts.length > 0) {
                        text += `\n${extraParts.join(', ')}`;
                    }
                    return text;
                }
            } catch (err) {
                console.error('[Parameters Builder] Regex fallback failed:', err);
            }
            return infoJsonStr;
        }
    }

    let text = prompt;
    if (negativePrompt) {
        text += `\nNegative prompt: ${negativePrompt}`;
    }
    return text;
}

function writeWebpParametersNode(base64Image: string, parametersText: string): string {
    try {
        const imageBuffer = Buffer.from(base64Image, 'base64');
        
        // WebP シグネチャ確認 (RIFF .... WEBP)
        if (imageBuffer[0] !== 0x52 || imageBuffer[1] !== 0x49 || imageBuffer[2] !== 0x46 || imageBuffer[3] !== 0x46 ||
            imageBuffer[8] !== 0x57 || imageBuffer[9] !== 0x45 || imageBuffer[10] !== 0x42 || imageBuffer[11] !== 0x50) {
            return base64Image;
        }

        const textBuf = Buffer.from(parametersText, 'utf8');
        
        // カスタムチャンク 'para'
        const chunkHeader = Buffer.alloc(8);
        chunkHeader.write('para', 0, 'utf8');
        chunkHeader.writeUInt32LE(textBuf.length, 4);

        let paddingBuf = Buffer.alloc(0);
        if (textBuf.length % 2 !== 0) {
            paddingBuf = Buffer.alloc(1, 0x00);
        }

        const customChunk = Buffer.concat([chunkHeader, textBuf, paddingBuf]);

        const originalRiffSize = imageBuffer.readUInt32LE(4);
        const newRiffSize = originalRiffSize + customChunk.length;

        // 新しいバッファを作成（RIFFサイズを更新し、カスタムチャンクは末尾に結合）
        const newBuffer = Buffer.alloc(imageBuffer.length + customChunk.length);
        imageBuffer.copy(newBuffer, 0);
        newBuffer.writeUInt32LE(newRiffSize, 4);
        customChunk.copy(newBuffer, imageBuffer.length);

        return newBuffer.toString('base64');
    } catch (e) {
        console.error('[WebP Writer Node] Failed to embed metadata:', e);
        return base64Image;
    }
}

function writeJpegParametersNode(base64Image: string, parametersText: string): string {
    try {
        const imageBuffer = Buffer.from(base64Image, 'base64');
        
        // JPEG シグネチャ確認 (FF D8)
        if (imageBuffer[0] !== 0xFF || imageBuffer[1] !== 0xD8) {
            return base64Image;
        }

        const textBuf = Buffer.from(parametersText, 'utf8');
        
        // Comment セグメント (FF FE) の作成
        const segmentHeader = Buffer.alloc(4);
        segmentHeader[0] = 0xFF;
        segmentHeader[1] = 0xFE;
        segmentHeader.writeUInt16BE(textBuf.length + 2, 2);

        const customSegment = Buffer.concat([segmentHeader, textBuf]);

        const newBuffer = Buffer.concat([
            imageBuffer.slice(0, 2),
            customSegment,
            imageBuffer.slice(2)
        ]);

        return newBuffer.toString('base64');
    } catch (e) {
        console.error('[JPEG Writer Node] Failed to embed metadata:', e);
        return base64Image;
    }
}
