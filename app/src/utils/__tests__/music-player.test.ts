import { describe, expect, it } from 'vitest';
import { formatPlaybackTime, getNextTrackIndex, parseMusicTrackLabel } from '../music-player';

describe('parseMusicTrackLabel', () => {
    it('parseMusicTrackLabel_アーティスト区切りを含むファイル名を解析できること', () => {
        expect(parseMusicTrackLabel('Sample Artist - Sample Song.mp3')).toEqual({
            artist: 'Sample Artist',
            title: 'Sample Song'
        });
    });

    it('parseMusicTrackLabel_区切りがないファイル名を曲名として扱うこと', () => {
        expect(parseMusicTrackLabel('Sample Song.flac')).toEqual({
            artist: '',
            title: 'Sample Song'
        });
    });
});
describe('getNextTrackIndex', () => {
    it('getNextTrackIndex_末尾から先頭へ循環すること', () => {
        expect(getNextTrackIndex(2, 3)).toBe(0);
    });

    it('getNextTrackIndex_先頭から前の曲へ移動すると末尾になること', () => {
        expect(getNextTrackIndex(0, 3, { direction: -1 })).toBe(2);
    });

    it('getNextTrackIndex_シャッフル時に現在の曲以外を返すこと', () => {
        expect(getNextTrackIndex(1, 4, { shuffle: true, random: () => 0 })).toBe(2);
    });

    it('getNextTrackIndex_空のプレイリストではマイナス1を返すこと', () => {
        expect(getNextTrackIndex(0, 0)).toBe(-1);
    });
});

describe('formatPlaybackTime', () => {
    it('formatPlaybackTime_秒数を分秒形式へ変換すること', () => {
        expect(formatPlaybackTime(125.9)).toBe('2:05');
    });

    it('formatPlaybackTime_不正な値をゼロとして表示すること', () => {
        expect(formatPlaybackTime(Number.NaN)).toBe('0:00');
    });
});
