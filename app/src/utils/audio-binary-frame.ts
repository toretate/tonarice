import type { AudioCodec, BinaryAudioPayload } from '../types/audio';

const MAGIC = new Uint8Array([0x44, 0x41, 0x4d, 0x31]);
const AUDIO_MESSAGE_TYPE = 0x01;
const HEADER_SIZE = 8;

function getCodecId(codec: AudioCodec): number {
    return codec === 'mp3' ? 0x02 : 0x01;
}

function getCodec(codecId: number): Pick<BinaryAudioPayload, 'codec' | 'mimeType' | 'extension'> {
    if (codecId === 0x01) {
        return { codec: 'pcm_s16le', mimeType: 'audio/wav', extension: 'wav' };
    }
    if (codecId === 0x02) {
        return { codec: 'mp3', mimeType: 'audio/mpeg', extension: 'mp3' };
    }
    throw new Error(`未対応の音声コーデックです: ${codecId}`);
}

export function encodeAudioBinaryFrame(bytes: Uint8Array, codec: AudioCodec): Uint8Array {
    const frame = new Uint8Array(HEADER_SIZE + bytes.byteLength);
    frame.set(MAGIC, 0);
    frame[4] = AUDIO_MESSAGE_TYPE;
    frame[5] = getCodecId(codec);
    frame.set(bytes, HEADER_SIZE);
    return frame;
}

export function decodeAudioBinaryFrame(buffer: ArrayBufferLike): BinaryAudioPayload {
    const frame = new Uint8Array(buffer);
    if (frame.byteLength < HEADER_SIZE || !MAGIC.every((value, index) => frame[index] === value)) {
        throw new Error('音声バイナリフレームの形式が不正です。');
    }
    if (frame[4] !== AUDIO_MESSAGE_TYPE) {
        throw new Error(`未対応のバイナリメッセージです: ${frame[4]}`);
    }

    const metadata = getCodec(frame[5]);
    return {
        ...metadata,
        blob: new Blob([frame.slice(HEADER_SIZE)], { type: metadata.mimeType })
    };
}
