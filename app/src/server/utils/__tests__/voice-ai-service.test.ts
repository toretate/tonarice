import { afterEach, describe, expect, test, vi } from 'vitest';
import { VoiceAiService } from '../voice-ai-service';

describe('VoiceAiService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('synthesizeIrodori - LoRAアダプターのパスをirodori固有設定として送信すること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await VoiceAiService.synthesizeIrodori(
            'LoRAテスト',
            'http://127.0.0.1:8088',
            'irodori-tts',
            'speaker-a',
            'neutral',
            false,
            '  models/adapters/speaker-a  '
        );

        expect(result).toEqual({
            data: Buffer.from([1, 2, 3]).toString('base64'),
            mimeType: 'audio/mpeg',
            extension: 'mp3',
            codec: 'mp3'
        });

        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toMatchObject({
            model: 'irodori-tts',
            input: 'LoRAテスト',
            voice: 'speaker-a',
            response_format: 'mp3',
            irodori: {
                lora_adapter: 'models/adapters/speaker-a'
            }
        });
    });

    test('synthesizeIrodori - 再生速度とcaptionをirodori固有設定として送信すること', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
        });
        vi.stubGlobal('fetch', fetchMock);

        await VoiceAiService.synthesizeIrodori(
            'captionテスト',
            'http://127.0.0.1:8088',
            'irodori-tts',
            'speaker-a',
            'neutral',
            false,
            undefined,
            1.5,
            '  落ち着いた、やさしい声で話す  '
        );

        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toMatchObject({
            speed: 1.5,
            irodori: {
                caption: '落ち着いた、やさしい声で話す'
            }
        });
    });

    test('synthesizeIrodori - TTS送信内容デバッグに本文、LoRA、voice idを表示すること', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
        }));
        const logMock = vi.spyOn(console, 'log').mockImplementation(() => {});

        await VoiceAiService.synthesizeIrodori(
            'デバッグ本文',
            'http://127.0.0.1:8088',
            'irodori-tts',
            'voice-debug',
            'neutral',
            true,
            'models/adapters/debug',
            1.25,
            '明るく親しみやすい声で話す'
        );

        expect(logMock.mock.calls.some(([message]) => String(message).includes('TTS送信内容デバッグ'))).toBe(true);
        const debugMessage = logMock.mock.calls
            .map(([message]) => String(message))
            .find(message => message.includes('TTS送信内容デバッグ'));
        expect(debugMessage).toContain('デバッグ本文');
        expect(debugMessage).toContain('models/adapters/debug');
        expect(debugMessage).toContain('voice-debug');
        expect(debugMessage).toContain('1.25');
        expect(debugMessage).toContain('明るく親しみやすい声で話す');
    });
});
