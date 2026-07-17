// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useMusicStore } from '../music';

describe('useMusicStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
    });

    it('loadFromLocalStorage_保存されたプレイヤー設定を復元すること', () => {
        localStorage.setItem('desktop-mascot-show-music-widget', 'true');
        localStorage.setItem('desktop-mascot-music-volume', '0.35');
        localStorage.setItem('desktop-mascot-music-repeat-mode', 'one');
        localStorage.setItem('desktop-mascot-music-shuffle', 'true');
        localStorage.setItem('desktop-mascot-music-opacity', '0.65');
        localStorage.setItem('desktop-mascot-music-playlist-expanded', 'true');
        localStorage.setItem('desktop-mascot-music-muted', 'true');
        localStorage.setItem('desktop-mascot-music-restore-mode', 'directory-input');
        localStorage.setItem('desktop-mascot-music-folder-name', 'Music');
        localStorage.setItem('desktop-mascot-music-track-key', 'Album/song.mp3');
        localStorage.setItem('desktop-mascot-music-track-size', '123');
        localStorage.setItem('desktop-mascot-music-track-last-modified', '456');
        localStorage.setItem('desktop-mascot-music-playback-position', '78.5');

        const store = useMusicStore();
        store.loadFromLocalStorage();

        expect(store.showMusicWidget).toBe(true);
        expect(store.volume).toBe(0.35);
        expect(store.repeatMode).toBe('one');
        expect(store.shuffle).toBe(true);
        expect(store.opacity).toBe(0.65);
        expect(store.playlistExpanded).toBe(true);
        expect(store.muted).toBe(true);
        expect(store.restoreMode).toBe('directory-input');
        expect(store.folderName).toBe('Music');
        expect(store.trackKey).toBe('Album/song.mp3');
        expect(store.trackSize).toBe(123);
        expect(store.trackLastModified).toBe(456);
        expect(store.playbackPosition).toBe(78.5);
    });

    it('loadFromLocalStorage_音量を有効範囲に補正すること', () => {
        localStorage.setItem('desktop-mascot-music-volume', '2');

        const store = useMusicStore();
        store.loadFromLocalStorage();

        expect(store.volume).toBe(1);
    });

    it('cycleRepeatMode_リピートモードを順番に切り替えること', () => {
        const store = useMusicStore();
        store.loadFromLocalStorage();

        store.cycleRepeatMode();
        expect(store.repeatMode).toBe('all');
        store.cycleRepeatMode();
        expect(store.repeatMode).toBe('one');
        store.cycleRepeatMode();
        expect(store.repeatMode).toBe('off');
    });

    it('clearRestoreState_クライアントの復元情報を消去すること', () => {
        const store = useMusicStore();
        store.loadFromLocalStorage();
        store.setRestoreTarget({
            mode: 'file-system-access',
            folderName: 'Music',
            trackKey: 'song.mp3',
            size: 100,
            lastModified: 200,
            position: 30
        });

        store.clearRestoreState();

        expect(store.restoreMode).toBe('none');
        expect(store.folderName).toBe('');
        expect(store.trackKey).toBe('');
        expect(store.playbackPosition).toBe(0);
    });
});
