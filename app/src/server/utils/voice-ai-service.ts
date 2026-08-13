import type { Base64AudioPayload } from '../../types/audio';
import { createMp3Payload, encodeVoicevoxAudio } from './voice-audio-transcoder';
import { normalizeIrodoriSpeed } from '../../utils/irodori-tts-settings';

export class VoiceAiService {
    /**
     * VOICEVOXを使用して音声を合成し、Base64形式の音声データを返します。
     */
    public static async synthesize(text: string, speakerId: number, endpoint: string, showVoiceLog: boolean = true): Promise<Base64AudioPayload | null> {
        const baseUrl = endpoint || 'http://localhost:50021';
        const speaker = speakerId !== undefined ? speakerId : 2;

        if (showVoiceLog) {
            console.log(`[VoiceAiService] TTS送信内容デバッグ: ${JSON.stringify({
                engine: 'voicevox',
                content: text,
                lora: 'なし',
                voiceId: speaker
            })}`);
        }

        const voiceController = new AbortController();
        const voiceTimeoutId = setTimeout(() => voiceController.abort(), 60000);

        try {
            const encodedText = encodeURIComponent(text);
            const queryUrl = baseUrl.endsWith('/')
                ? `${baseUrl}audio_query?text=${encodedText}&speaker=${speaker}`
                : `${baseUrl}/audio_query?text=${encodedText}&speaker=${speaker}`;

            // 1. クエリ作成
            const queryResponse = await fetch(queryUrl, {
                method: 'POST',
                signal: voiceController.signal
            });

            if (!queryResponse.ok) {
                throw new Error(`VOICEVOX Query Error: ${queryResponse.status}`);
            }

            const audioQuery = await queryResponse.json();

            // 2. 音声合成
            const synthesisUrl = baseUrl.endsWith('/')
                ? `${baseUrl}synthesis?speaker=${speaker}`
                : `${baseUrl}/synthesis?speaker=${speaker}`;

            const synthResponse = await fetch(synthesisUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(audioQuery),
                signal: voiceController.signal
            });

            clearTimeout(voiceTimeoutId);

            if (!synthResponse.ok) {
                throw new Error(`VOICEVOX Synthesis Error: ${synthResponse.status}`);
            }

            const arrayBuffer = await synthResponse.arrayBuffer();
            const audio = await encodeVoicevoxAudio(Buffer.from(arrayBuffer));

            if (showVoiceLog) {
                console.log(`[VoiceAiService] VOICEVOX synthesize success`);
            }
            return audio;
        } catch (voiceError: any) {
            clearTimeout(voiceTimeoutId);
            if (voiceError.name === 'AbortError') {
                console.warn('[VoiceAiService] VOICEVOXとの接続エラー (タイムアウト/タスクキャンセル)');
            } else if (voiceError.name === 'TypeError' || voiceError.code === 'ECONNREFUSED') {
                console.warn('[VoiceAiService] VOICEVOXとの接続エラー (接続失敗/ネットワークエラー)');
            } else {
                console.warn('[VoiceAiService] VOICEVOXとの接続エラー:', voiceError.message);
            }
            return null;
        }
    }

    /**
     * irodori-tts (OpenAI 互換) を使用して音声を合成し、Base64形式の音声データを返します。
     */
    public static async synthesizeIrodori(
        text: string,
        endpoint: string,
        model: string,
        voice: string,
        emotion?: string,
        showVoiceLog: boolean = true,
        loraAdapter?: string,
        speed?: number,
        caption?: string
    ): Promise<Base64AudioPayload | null> {
        const baseUrl = endpoint || 'http://127.0.0.1:8088';
        let targetModel = model || 'irodori-tts';
        if (targetModel === 'irodori-tts-500m-v3') {
            targetModel = 'irodori-tts';
        }
        const targetVoice = voice || 'default';
        const normalizedLoraAdapter = loraAdapter?.trim();
        const targetSpeed = normalizeIrodoriSpeed(speed);
        const normalizedCaption = caption?.trim();
        const irodoriOptions = {
            ...(normalizedLoraAdapter ? { lora_adapter: normalizedLoraAdapter } : {}),
            ...(normalizedCaption ? { caption: normalizedCaption } : {})
        };

        let textWithEmotion = text;

        if (showVoiceLog) {
            console.log(`[VoiceAiService] TTS送信内容デバッグ: ${JSON.stringify({
                engine: 'irodori',
                content: textWithEmotion,
                lora: normalizedLoraAdapter || 'なし',
                voiceId: targetVoice,
                speed: targetSpeed,
                caption: normalizedCaption || 'なし'
            })}`);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
            const url = baseUrl.endsWith('/') ? `${baseUrl}v1/audio/speech` : `${baseUrl}/v1/audio/speech`;
            const requestBody = {
                model: targetModel,
                input: textWithEmotion,
                voice: targetVoice,
                response_format: 'mp3',
                speed: targetSpeed,
                ...(Object.keys(irodoriOptions).length > 0 ? { irodori: irodoriOptions } : {})
            };
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`OpenAI TTS Error: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const audio = createMp3Payload(Buffer.from(arrayBuffer));

            if (showVoiceLog) {
                console.log(`[VoiceAiService] irodori-tts synthesize success`);
            }
            return audio;
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                console.warn('[VoiceAiService] irodori-ttsとの接続エラー (タイムアウト/タスクキャンセル)');
            } else if (error.name === 'TypeError' || error.code === 'ECONNREFUSED') {
                console.warn('[VoiceAiService] irodori-ttsとの接続エラー (接続失敗/ネットワークエラー)');
            } else {
                console.warn('[VoiceAiService] irodori-ttsとの接続エラー:', error.message);
            }
            return null;
        }
    }

    /**
     * 感情名に対応する Irodori-TTS の感情表現用絵文字を取得します。
     */
    public static getIrodoriEmoji(emotion?: string): string {
        if (!emotion) return '';
        const lower = emotion.toLowerCase().trim();

        switch (lower) {
            case 'admiration':
                return ' 🫶';
            case 'amusement':
                return ' 🤭';
            case 'anger':
                return ' 😠';
            case 'annoyance':
                return ' 😒';
            case 'approval':
                return ' 👌';
            case 'caring':
                return ' 🫶';
            case 'confusion':
                return ' 🤔';
            case 'curiosity':
                return ' 🤔';
            case 'desire':
                return ' 😏';
            case 'disappointment':
                return ' 😮‍💨';
            case 'disapproval':
                return ' 🙄';
            case 'disgust':
                return ' 😒';
            case 'embarrassment':
                return ' 🫣';
            case 'excitement':
                return ' 😆';
            case 'fear':
                return ' 😱';
            case 'gratitude':
                return ' 🙏';
            case 'grief':
                return ' 😭';
            case 'joy':
                return ' 😆';
            case 'love':
                return ' 🫶';
            case 'nervousness':
                return ' 🥺';
            case 'optimism':
                return ' 😊';
            case 'pride':
                return ' 😏';
            case 'realization':
                return ' 😲';
            case 'relief':
                return ' 😌';
            case 'remorse':
                return ' 😭';
            case 'sadness':
                return ' 😭';
            case 'surprise':
                return ' 😲';
            case 'neutral':
                return '';
        }

        if (lower === 'happy' || lower === '嬉' || lower === '楽') {
            return ' 😊';
        }
        if (lower === '喜び' || lower === 'joy') {
            return ' 😆';
        }
        if (lower === 'sad' || lower === '悲しみ' || lower === '哀' || lower === '悲') {
            return ' 😭';
        }
        if (lower === 'angry' || lower === '怒り' || lower === '怒') {
            return ' 😠';
        }
        if (lower === 'surprised' || lower === '驚き' || lower === '驚') {
            return ' 😲';
        }
        if (lower === 'nervous' || lower === '不安') {
            return ' 🥺';
        }
        if (lower === 'scared' || lower === '恐れ' || lower === '恐怖') {
            return ' 😱';
        }
        if (lower === '安堵' || lower === 'ホッ') {
            return ' 😌';
        }
        if (lower === '照れ' || lower === '恥ずかしい') {
            return ' 🫣';
        }

        return '';
    }
}
