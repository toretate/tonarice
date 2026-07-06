import { defineEventHandler, readBody } from 'h3';
import { VoiceAiService } from '../utils/voice-ai-service';

export default defineEventHandler(async (event) => {
    const body = await readBody(event);
    const { engine, text, endpoint, model, voice, speakerId, emotion } = body;

    try {
        let base64Audio: string | null = null;

        if (engine === 'irodori') {
            base64Audio = await VoiceAiService.synthesizeIrodori(
                text,
                endpoint,
                model,
                voice,
                emotion,
                true
            );
        } else {
            // デフォルトは VOICEVOX
            const targetSpeakerId = speakerId !== undefined ? Number(speakerId) : 1;
            base64Audio = await VoiceAiService.synthesize(
                text,
                targetSpeakerId,
                endpoint,
                true
            );
        }

        return {
            success: base64Audio !== null,
            audio: base64Audio
        };
    } catch (error: any) {
        console.error('[API TTS] 音声合成エラー:', error);
        return {
            success: false,
            audio: null,
            error: error.message
        };
    }
});
