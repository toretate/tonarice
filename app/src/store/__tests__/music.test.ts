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

        const store = useMusicStore();
        store.loadFromLocalStorage();

        expect(store.showMusicWidget).toBe(true);
        expect(store.volume).toBe(0.35);
        expect(store.repeatMode).toBe('one');
        expect(store.shuffle).toBe(true);
        expect(store.opacity).toBe(0.65);
        expect(store.playlistExpanded).toBe(true);
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
});
