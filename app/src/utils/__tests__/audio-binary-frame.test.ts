// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { decodeAudioBinaryFrame, encodeAudioBinaryFrame } from '../audio-binary-frame';

describe('音声バイナリフレームのテスト', () => {
    it('encodeAudioBinaryFrame_MP3をDAM1フレームへ変換すること', () => {
        const frame = encodeAudioBinaryFrame(new Uint8Array([1, 2, 3]), 'mp3');
        expect([...frame]).toEqual([0x44, 0x41, 0x4d, 0x31, 0x01, 0x02, 0x00, 0x00, 1, 2, 3]);
    });

    it('decodeAudioBinaryFrame_WAVフレームをMIMEタイプ付きBlobへ変換すること', async () => {
        const frame = encodeAudioBinaryFrame(new Uint8Array([4, 5]), 'pcm_s16le');
        const audio = decodeAudioBinaryFrame(frame.buffer);

        expect(audio.mimeType).toBe('audio/wav');
        expect(audio.codec).toBe('pcm_s16le');
        expect([...new Uint8Array(await audio.blob.arrayBuffer())]).toEqual([4, 5]);
    });

    it('decodeAudioBinaryFrame_不正なマジックを拒否すること', () => {
        expect(() => decodeAudioBinaryFrame(new ArrayBuffer(8))).toThrow('形式が不正');
    });
});
