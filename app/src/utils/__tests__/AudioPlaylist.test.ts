// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlaylist } from '../AudioPlaylist';

describe('AudioPlaylist', () => {
    const originalAudio = globalThis.Audio;

    afterEach(() => {
        globalThis.Audio = originalAudio;
        vi.restoreAllMocks();
    });

    it('受信したMIMEタイプをData URLへ反映すること', () => {
        const audioConstructor = vi.fn(function (this: HTMLAudioElement, src: string) {
            this.src = src;
            this.play = vi.fn().mockResolvedValue(undefined);
            this.pause = vi.fn();
        });
        globalThis.Audio = audioConstructor as unknown as typeof Audio;

        const playlist = new AudioPlaylist();
        playlist.push({
            data: 'bXAz',
            mimeType: 'audio/mpeg',
            extension: 'mp3',
            codec: 'mp3'
        });

        expect(audioConstructor).toHaveBeenCalledWith('data:audio/mpeg;base64,bXAz');
    });

    it('従来のBase64文字列はWAVとして再生すること', () => {
        const audioConstructor = vi.fn(function (this: HTMLAudioElement, src: string) {
            this.src = src;
            this.play = vi.fn().mockResolvedValue(undefined);
            this.pause = vi.fn();
        });
        globalThis.Audio = audioConstructor as unknown as typeof Audio;

        const playlist = new AudioPlaylist();
        playlist.push('d2F2');

        expect(audioConstructor).toHaveBeenCalledWith('data:audio/wav;base64,d2F2');
    });

    it('push_バイナリ音声をBlob URLで再生し終了時に解放すること', () => {
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-test');
        let createdAudio: HTMLAudioElement | null = null;
        const audioConstructor = vi.fn(function (this: HTMLAudioElement, src: string) {
            this.src = src;
            this.play = vi.fn().mockResolvedValue(undefined);
            this.pause = vi.fn();
            createdAudio = this;
        });
        globalThis.Audio = audioConstructor as unknown as typeof Audio;

        const playlist = new AudioPlaylist();
        playlist.push({
            blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
            mimeType: 'audio/mpeg',
            extension: 'mp3',
            codec: 'mp3'
        });
        createdAudio!.onended?.(new Event('ended'));

        expect(audioConstructor).toHaveBeenCalledWith('blob:audio-test');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-test');
    });

    it('stop_再生中のBlob URLを解放すること', () => {
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio-stop');
        const audioConstructor = vi.fn(function (this: HTMLAudioElement, src: string) {
            this.src = src;
            this.play = vi.fn().mockResolvedValue(undefined);
            this.pause = vi.fn();
        });
        globalThis.Audio = audioConstructor as unknown as typeof Audio;

        const playlist = new AudioPlaylist();
        playlist.push({
            blob: new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
            mimeType: 'audio/wav',
            extension: 'wav',
            codec: 'pcm_s16le'
        });
        playlist.stop();

        expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-stop');
    });
});
