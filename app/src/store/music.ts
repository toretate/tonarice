import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { RepeatMode } from '../utils/music-player';

const STORAGE_KEYS = {
    visible: 'desktop-mascot-show-music-widget',
    volume: 'desktop-mascot-music-volume',
    repeatMode: 'desktop-mascot-music-repeat-mode',
    shuffle: 'desktop-mascot-music-shuffle',
    opacity: 'desktop-mascot-music-opacity',
    playlistExpanded: 'desktop-mascot-music-playlist-expanded'
} as const;

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

export const useMusicStore = defineStore('music', () => {
    const showMusicWidget = ref(false);
    const volume = ref(0.8);
    const repeatMode = ref<RepeatMode>('off');
    const shuffle = ref(false);
    const opacity = ref(0.92);
    const playlistExpanded = ref(false);
    const isLoaded = ref(false);

    const loadFromLocalStorage = () => {
        if (typeof window === 'undefined') return;

        try {
            showMusicWidget.value = localStorage.getItem(STORAGE_KEYS.visible) === 'true';

            const savedVolume = Number.parseFloat(localStorage.getItem(STORAGE_KEYS.volume) ?? '');
            if (Number.isFinite(savedVolume)) volume.value = clampVolume(savedVolume);

            const savedRepeatMode = localStorage.getItem(STORAGE_KEYS.repeatMode);
            if (savedRepeatMode === 'off' || savedRepeatMode === 'all' || savedRepeatMode === 'one') {
                repeatMode.value = savedRepeatMode;
            }

            shuffle.value = localStorage.getItem(STORAGE_KEYS.shuffle) === 'true';

            const savedOpacity = Number.parseFloat(localStorage.getItem(STORAGE_KEYS.opacity) ?? '');
            if (Number.isFinite(savedOpacity)) opacity.value = clampVolume(savedOpacity);

            const savedPlaylistExpanded = localStorage.getItem(STORAGE_KEYS.playlistExpanded);
            if (savedPlaylistExpanded !== null) playlistExpanded.value = savedPlaylistExpanded === 'true';
        } catch (error) {
            console.warn('LocalStorageからの音楽設定読み込みエラー:', error);
        } finally {
            isLoaded.value = true;
        }
    };

    const saveToLocalStorage = () => {
        if (typeof window === 'undefined' || !isLoaded.value) return;

        try {
            localStorage.setItem(STORAGE_KEYS.visible, String(showMusicWidget.value));
            localStorage.setItem(STORAGE_KEYS.volume, String(clampVolume(volume.value)));
            localStorage.setItem(STORAGE_KEYS.repeatMode, repeatMode.value);
            localStorage.setItem(STORAGE_KEYS.shuffle, String(shuffle.value));
            localStorage.setItem(STORAGE_KEYS.opacity, String(clampVolume(opacity.value)));
            localStorage.setItem(STORAGE_KEYS.playlistExpanded, String(playlistExpanded.value));
        } catch (error) {
            console.error('LocalStorageへの音楽設定保存エラー:', error);
        }
    };

    watch([showMusicWidget, volume, repeatMode, shuffle, opacity, playlistExpanded], saveToLocalStorage);

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', event => {
            if (event.key && Object.values(STORAGE_KEYS).includes(event.key as typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS])) {
                loadFromLocalStorage();
            }
        });
    }

    const cycleRepeatMode = () => {
        const modes: RepeatMode[] = ['off', 'all', 'one'];
        repeatMode.value = modes[(modes.indexOf(repeatMode.value) + 1) % modes.length];
    };

    return {
        showMusicWidget,
        volume,
        repeatMode,
        shuffle,
        opacity,
        playlistExpanded,
        isLoaded,
        loadFromLocalStorage,
        saveToLocalStorage,
        cycleRepeatMode
    };
});
