export type RepeatMode = 'off' | 'all' | 'one';

export interface MusicTrackLabel {
    title: string;
    artist: string;
}

const AUDIO_FILE_EXTENSION = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i;

export const parseMusicTrackLabel = (fileName: string): MusicTrackLabel => {
    const baseName = fileName.replace(AUDIO_FILE_EXTENSION, '').trim();
    const separatorIndex = baseName.indexOf(' - ');

    if (separatorIndex <= 0) {
        return { title: baseName || fileName, artist: '' };
    }

    return {
        artist: baseName.slice(0, separatorIndex).trim(),
        title: baseName.slice(separatorIndex + 3).trim() || baseName
    };
};
export const getNextTrackIndex = (
    currentIndex: number,
    trackCount: number,
    options: { direction?: 1 | -1; shuffle?: boolean; random?: () => number } = {}
): number => {
    if (trackCount <= 0) return -1;
    if (trackCount === 1) return 0;

    const direction = options.direction ?? 1;
    if (!options.shuffle || direction === -1) {
        return (currentIndex + direction + trackCount) % trackCount;
    }

    const random = options.random ?? Math.random;
    const offset = 1 + Math.floor(random() * (trackCount - 1));
    return (currentIndex + offset) % trackCount;
};

export const formatPlaybackTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = wholeSeconds % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};
