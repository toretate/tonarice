// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scanMusicDirectory, type MusicDirectoryHandle } from '../music-directory-handle';

const directory = (name: string, entries: any[]): MusicDirectoryHandle => ({
    kind: 'directory',
    name,
    async *values() {
        for (const entry of entries) yield entry;
    }
});

describe('music-directory-handle', () => {
    it('scanMusicDirectory_サブフォルダを含む相対パスを返すこと', async () => {
        const song = new File(['music'], 'song.mp3', { type: 'audio/mpeg' });
        const root = directory('Music', [
            directory('Album', [{ kind: 'file', name: 'song.mp3', getFile: async () => song }])
        ]);

        const files = await scanMusicDirectory(root);

        expect(files).toEqual([{ file: song, relativePath: 'Album/song.mp3' }]);
    });
});
