<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '../store/config';
import { useMusicStore } from '../store/music';
import { formatPlaybackTime, getNextTrackIndex, parseMusicTrackLabel } from '../utils/music-player';

interface MusicTrack {
    id: string;
    url: string;
    title: string;
    artist: string;
}

const configStore = useConfigStore();
const musicStore = useMusicStore();
const { windowMode } = storeToRefs(configStore);
const { volume, repeatMode, shuffle, opacity, playlistExpanded } = storeToRefs(musicStore);

const audioRef = ref<HTMLAudioElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const tracks = ref<MusicTrack[]>([]);
const currentIndex = ref(-1);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const playbackError = ref('');
let shouldAutoplayAfterLoad = false;

const currentTrack = computed(() => tracks.value[currentIndex.value] ?? null);
const isStandalone = computed(() => window.location.hash === '#music');
const isIntegrated = computed(() => !isStandalone.value && windowMode.value === 'integrated');
const isCompact = computed(() => !isStandalone.value && windowMode.value === 'compact');
const repeatTitle = computed(() => ({
    off: 'リピートなし',
    all: '全曲リピート',
    one: '1曲リピート'
}[repeatMode.value]));

const setMediaSessionMetadata = () => {
    if (!currentTrack.value || !('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.value.title,
        artist: currentTrack.value.artist || 'ローカル音源'
    });
};

const handleLoadedMetadata = () => {
    const loadedDuration = audioRef.value?.duration ?? 0;
    duration.value = Number.isFinite(loadedDuration) ? loadedDuration : 0;
    setMediaSessionMetadata();
    if (shouldAutoplayAfterLoad) {
        shouldAutoplayAfterLoad = false;
        void play();
    }
};

const play = async () => {
    const audio = audioRef.value;
    if (!audio || !currentTrack.value) return;

    try {
        playbackError.value = '';
        await audio.play();
    } catch (error) {
        console.warn('ローカル音楽の再生に失敗しました:', error);
        playbackError.value = 'この音声ファイルを再生できませんでした。';
    }
};

const selectTrack = async (index: number, autoplay = true) => {
    if (index < 0 || index >= tracks.value.length) return;
    shouldAutoplayAfterLoad = autoplay;
    currentTime.value = 0;
    duration.value = 0;

    if (currentIndex.value === index) {
        const audio = audioRef.value;
        if (audio) audio.currentTime = 0;
        if (autoplay) await play();
        return;
    }

    currentIndex.value = index;
    await nextTick();
    audioRef.value?.load();
};

const moveTrack = (direction: 1 | -1, autoplay = isPlaying.value) => {
    const nextIndex = getNextTrackIndex(currentIndex.value, tracks.value.length, {
        direction,
        shuffle: shuffle.value
    });
    if (nextIndex >= 0) void selectTrack(nextIndex, autoplay);
};

const togglePlayback = () => {
    const audio = audioRef.value;
    if (!audio) return;
    if (isPlaying.value) audio.pause();
    else void play();
};

const handleFiles = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const selectedFiles = Array.from(input.files ?? []).filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(file.name));
    if (selectedFiles.length === 0) return;

    clearPlaylist();
    const addedTracks = selectedFiles.map((file, index) => {
        const label = parseMusicTrackLabel(file.name);
        return {
            id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
            url: URL.createObjectURL(file),
            ...label
        };
    });
    tracks.value.push(...addedTracks);
    input.value = '';
    void selectTrack(0, true);
};

const removeTrack = (index: number) => {
    const track = tracks.value[index];
    if (!track) return;
    URL.revokeObjectURL(track.url);

    const removingCurrent = index === currentIndex.value;
    const resumePlayback = removingCurrent && isPlaying.value;
    tracks.value.splice(index, 1);

    if (tracks.value.length === 0) {
        currentIndex.value = -1;
        isPlaying.value = false;
        currentTime.value = 0;
        duration.value = 0;
    } else if (index < currentIndex.value) {
        currentIndex.value -= 1;
    } else if (removingCurrent) {
        currentIndex.value = Math.min(index, tracks.value.length - 1);
        shouldAutoplayAfterLoad = resumePlayback;
        void nextTick(() => audioRef.value?.load());
    }
};

const clearPlaylist = () => {
    audioRef.value?.pause();
    tracks.value.forEach(track => URL.revokeObjectURL(track.url));
    tracks.value = [];
    currentIndex.value = -1;
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    playbackError.value = '';
};

const handleEnded = () => {
    if (repeatMode.value === 'one') {
        if (audioRef.value) audioRef.value.currentTime = 0;
        void play();
        return;
    }

    const isLastTrack = currentIndex.value === tracks.value.length - 1;
    if (isLastTrack && repeatMode.value === 'off' && !shuffle.value) {
        isPlaying.value = false;
        return;
    }
    moveTrack(1, true);
};

const seek = (event: Event) => {
    const audio = audioRef.value;
    if (!audio) return;
    audio.currentTime = Number((event.target as HTMLInputElement).value);
};

watch(volume, value => {
    if (audioRef.value) audioRef.value.volume = value;
});

const closeWidget = () => {
    musicStore.showMusicWidget = false;
    audioRef.value?.pause();
    if (isStandalone.value) {
        window.electronAPI?.toggleMusic?.();
    }
};

let isElectronDragging = false;
let electronDragX = 0;
let electronDragY = 0;

const startWidgetDrag = (event: MouseEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input')) return;
    if (!isStandalone.value) return;
    event.preventDefault();
    isElectronDragging = true;
    electronDragX = event.screenX;
    electronDragY = event.screenY;
    window.electronAPI?.dragWindow?.({ dx: 0, dy: 0, isStart: true });
    window.addEventListener('mousemove', handleElectronDrag);
    window.addEventListener('mouseup', stopElectronDrag);
};

const handleElectronDrag = (event: MouseEvent) => {
    if (!isElectronDragging) return;
    if (event.buttons !== 1) {
        stopElectronDrag();
        return;
    }

    const dx = event.screenX - electronDragX;
    const dy = event.screenY - electronDragY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        window.electronAPI?.dragWindow?.({ dx, dy });
        electronDragX = event.screenX;
        electronDragY = event.screenY;
    }
};

const stopElectronDrag = () => {
    if (!isElectronDragging) return;
    isElectronDragging = false;
    window.electronAPI?.dragWindow?.({ dx: 0, dy: 0, isEnd: true });
    window.removeEventListener('mousemove', handleElectronDrag);
    window.removeEventListener('mouseup', stopElectronDrag);
};

const widgetStyle = computed(() => {
    const transparentStyle = { opacity: String(opacity.value) };
    if (isIntegrated.value) {
        return { ...transparentStyle, left: '12px', right: '12px', bottom: '12px', top: 'auto', width: 'auto', height: 'auto' };
    }
    if (isCompact.value) {
        return { ...transparentStyle, left: '8px', right: '8px', top: '52px', width: 'auto', height: '38px' };
    }
    return { ...transparentStyle, left: '0', top: '0', width: '100%', height: '100%' };
});

const openMusicSettings = () => {
    localStorage.setItem('desktop-mascot-settings-menu', 'music');
    window.electronAPI?.openSettings?.();
};

onMounted(() => {
    if (!musicStore.isLoaded) musicStore.loadFromLocalStorage();
    if (audioRef.value) audioRef.value.volume = volume.value;

    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.setActionHandler('play', () => void play());
            navigator.mediaSession.setActionHandler('pause', () => audioRef.value?.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => moveTrack(-1));
            navigator.mediaSession.setActionHandler('nexttrack', () => moveTrack(1));
        } catch (error) {
            console.warn('メディアキー操作の登録に失敗しました:', error);
        }
    }
});

onUnmounted(() => {
    audioRef.value?.pause();
    tracks.value.forEach(track => URL.revokeObjectURL(track.url));
    window.removeEventListener('mousemove', handleElectronDrag);
    window.removeEventListener('mouseup', stopElectronDrag);
    stopElectronDrag();
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        for (const action of ['play', 'pause', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) {
            try {
                navigator.mediaSession.setActionHandler(action, null);
            } catch {
                // 未対応のアクションは解除不要です。
            }
        }
    }
});
</script>

<template>
    <section class="music-widget" :class="{ integrated: isIntegrated, compact: isCompact }" :style="widgetStyle">
        <header v-if="!isCompact" class="widget-header" @mousedown="startWidgetDrag">
            <div class="widget-title"><i class="pi pi-headphones"></i><span>MUSIC PLAYER</span></div>
            <div class="header-actions">
                <button type="button" title="音楽フォルダを選択" @click="fileInputRef?.click()"><i class="pi pi-folder-open"></i></button>
                <button type="button" title="音楽ウィジェット設定" @click="openMusicSettings"><i class="pi pi-cog"></i></button>
                <button type="button" title="閉じる" @click="closeWidget"><i class="pi pi-times"></i></button>
            </div>
        </header>

        <input
            ref="fileInputRef"
            class="file-input"
            type="file"
            webkitdirectory
            directory
            multiple
            @change="handleFiles"
        />
        <audio
            ref="audioRef"
            :src="currentTrack?.url"
            @loadedmetadata="handleLoadedMetadata"
            @timeupdate="currentTime = audioRef?.currentTime ?? 0"
            @play="isPlaying = true"
            @pause="isPlaying = false"
            @ended="handleEnded"
            @error="playbackError = currentTrack ? 'この音声ファイルを再生できませんでした。' : ''"
        ></audio>

        <div v-if="isCompact" class="compact-player-row">
            <button
                type="button"
                class="compact-track-title"
                :title="currentTrack ? currentTrack.title : '音楽フォルダを選択'"
                @click="!currentTrack && fileInputRef?.click()"
            >
                <i class="pi pi-music"></i>
                <span>{{ currentTrack?.title || '音楽フォルダを選択' }}</span>
            </button>
            <button type="button" class="compact-control" :title="isPlaying ? '一時停止' : '再生'" :disabled="!currentTrack" @click="togglePlayback">
                <i :class="isPlaying ? 'pi pi-pause' : 'pi pi-play'"></i>
            </button>
            <button type="button" class="compact-control" title="次の曲" :disabled="!currentTrack" @click="moveTrack(1)">
                <i class="pi pi-step-forward"></i>
            </button>
        </div>

        <div v-if="currentTrack && !isCompact" class="now-playing">
            <div class="cover"><i class="pi pi-music"></i></div>
            <div class="track-text">
                <strong :title="currentTrack.title">{{ currentTrack.title }}</strong>
                <span :title="currentTrack.artist">{{ currentTrack.artist || 'ローカル音源' }}</span>
            </div>
        </div>
        <button v-else-if="!isCompact" type="button" class="empty-state" @click="fileInputRef?.click()">
            <i class="pi pi-folder-open"></i>
            <span>音楽フォルダを選択</span>
            <small>フォルダ内の対応音源を読み込みます</small>
        </button>

        <div v-if="!isCompact" class="progress-row">
            <span>{{ formatPlaybackTime(currentTime) }}</span>
            <input type="range" min="0" :max="duration || 0" step="0.1" :value="currentTime" :disabled="!currentTrack" aria-label="再生位置" @input="seek" />
            <span>{{ formatPlaybackTime(duration) }}</span>
        </div>

        <div v-if="!isCompact" class="player-controls">
            <button type="button" :class="{ active: shuffle }" title="シャッフル" @click="shuffle = !shuffle"><i class="pi pi-sort-alt"></i></button>
            <button type="button" title="前の曲" :disabled="!currentTrack" @click="moveTrack(-1)"><i class="pi pi-step-backward"></i></button>
            <button type="button" class="play-button" :title="isPlaying ? '一時停止' : '再生'" :disabled="!currentTrack" @click="togglePlayback"><i :class="isPlaying ? 'pi pi-pause' : 'pi pi-play'"></i></button>
            <button type="button" title="次の曲" :disabled="!currentTrack" @click="moveTrack(1)"><i class="pi pi-step-forward"></i></button>
            <button type="button" :class="{ active: repeatMode !== 'off' }" :title="repeatTitle" @click="musicStore.cycleRepeatMode()"><i class="pi pi-replay"></i><small v-if="repeatMode === 'one'">1</small></button>
        </div>

        <div v-if="!isCompact" class="volume-row">
            <i :class="volume === 0 ? 'pi pi-volume-off' : 'pi pi-volume-up'"></i>
            <input v-model.number="volume" type="range" min="0" max="1" step="0.01" aria-label="音量" />
            <span>{{ Math.round(volume * 100) }}%</span>
        </div>

        <p v-if="playbackError && !isCompact" class="error-message">{{ playbackError }}</p>

        <div v-if="!isCompact" class="playlist-header">
            <button type="button" class="playlist-toggle" :aria-expanded="playlistExpanded" @click="playlistExpanded = !playlistExpanded">
                <i :class="playlistExpanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></i>
                <span>PLAYLIST <small>{{ tracks.length }}</small></span>
            </button>
            <button v-if="tracks.length" type="button" @click="clearPlaylist">すべて削除</button>
        </div>
        <ol v-if="playlistExpanded && !isCompact" class="playlist">
            <li v-for="(track, index) in tracks" :key="track.id" :class="{ current: index === currentIndex }">
                <button type="button" class="track-button" @click="selectTrack(index, true)">
                    <i :class="index === currentIndex && isPlaying ? 'pi pi-volume-up' : 'pi pi-music'"></i>
                    <span>{{ track.title }}</span>
                </button>
                <button type="button" class="remove-button" :title="`${track.title}を削除`" @click="removeTrack(index)"><i class="pi pi-times"></i></button>
            </li>
        </ol>
    </section>
</template>

<style scoped>
.music-widget {
    position: absolute;
    width: 340px;
    height: 440px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
    color: #334155;
    font-family: 'Outfit', 'Inter', sans-serif;
    box-sizing: border-box;
}

.widget-header, .widget-title, .header-actions, .now-playing, .progress-row, .player-controls, .volume-row, .playlist-header, .playlist li, .track-button {
    display: flex;
    align-items: center;
}

.widget-header { justify-content: space-between; min-height: 46px; padding: 0 12px; cursor: grab; border-bottom: 1px solid #f1f5f9; user-select: none; }
.widget-header:active { cursor: grabbing; }
.widget-title { gap: 8px; font-size: 14px; font-weight: 700; letter-spacing: 0.05em; color: #475569; }
.widget-title i { color: #8b5cf6; }
.header-actions { gap: 4px; }
button { border: 0; color: inherit; cursor: pointer; }
.header-actions button, .player-controls button { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: transparent; color: #64748b; }
.header-actions button:hover, .player-controls button:hover:not(:disabled) { background: #f1f5f9; color: #334155; }
.file-input, audio { display: none; }
.now-playing { gap: 12px; padding: 15px 16px 8px; }
.cover { display: grid; place-items: center; flex: 0 0 54px; height: 54px; border-radius: 10px; background: linear-gradient(135deg, #dbeafe, #ede9fe); color: #7c3aed; font-size: 21px; }
.track-text { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.track-text strong, .track-text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.track-text strong { color: #334155; font-size: 14px; }
.track-text span { color: #94a3b8; font-size: 12px; }
.empty-state { margin: 14px 16px 8px; min-height: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; color: #475569; }
.empty-state:hover { border-color: #8b5cf6; background: #faf5ff; }
.empty-state i { color: #8b5cf6; font-size: 18px; }
.empty-state small { color: #94a3b8; }
.progress-row { gap: 8px; padding: 4px 16px 0; color: #94a3b8; font-size: 10px; }
.progress-row input { flex: 1; min-width: 0; accent-color: #8b5cf6; }
.player-controls { justify-content: center; gap: 8px; padding: 4px 12px; }
.player-controls button:disabled { opacity: 0.35; cursor: default; }
.player-controls button.active { background: #f3e8ff; color: #7c3aed; }
.player-controls .play-button { width: 42px; height: 42px; border-radius: 50%; background: #8b5cf6; color: #ffffff; font-size: 16px; }
.player-controls .play-button:hover:not(:disabled) { background: #7c3aed; color: #ffffff; }
.player-controls small { position: absolute; margin: 0 0 9px 11px; font-size: 8px; font-weight: 800; }
.volume-row { gap: 8px; padding: 0 18px 8px; color: #94a3b8; font-size: 10px; }
.volume-row input { flex: 1; accent-color: #8b5cf6; }
.volume-row span { width: 30px; text-align: right; }
.error-message { margin: 0 16px 6px; color: #e11d48; font-size: 11px; }
.playlist-header { justify-content: space-between; padding: 8px 16px 5px; border-top: 1px solid #e2e8f0; background: #f8fafc; color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; }
.playlist-header small { padding: 1px 5px; border-radius: 999px; background: #e2e8f0; color: #64748b; }
.playlist-header button { padding: 2px 0; background: transparent; color: #7c3aed; font-size: 10px; }
.playlist { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 8px 10px; background: #f8fafc; list-style: none; }
.playlist li { min-height: 34px; margin-top: 4px; border: 1px solid transparent; border-radius: 8px; color: #475569; }
.playlist li.current { border-color: #ddd6fe; border-left: 3px solid #8b5cf6; background: #ffffff; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05); color: #5b21b6; }
.track-button { flex: 1; min-width: 0; gap: 8px; padding: 7px 8px; background: transparent; text-align: left; }
.track-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.track-button i { flex: 0 0 14px; color: #8b5cf6; font-size: 11px; }
.remove-button { opacity: 0; width: 28px; height: 28px; background: transparent; color: #94a3b8; }
.playlist li:hover .remove-button, .remove-button:focus { opacity: 1; }
input[type="range"] { height: 4px; }

.playlist-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0 !important;
    color: #64748b !important;
    font-weight: 700;
}

.playlist-toggle i {
    font-size: 9px;
}

/* 統合モードでは画面下部に固定する横長プレイヤー */
.music-widget.integrated {
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(180px, 0.9fr) minmax(220px, 1.4fr) auto minmax(150px, 0.7fr);
    align-items: center;
    max-height: min(360px, calc(100vh - 24px));
}

.integrated .widget-header,
.integrated .playlist-header,
.integrated .playlist,
.integrated .error-message {
    grid-column: 1 / -1;
}

.integrated .now-playing {
    min-width: 0;
    padding: 10px 14px;
}

.integrated .empty-state {
    min-height: 58px;
    margin: 10px 14px;
}

.integrated .progress-row {
    min-width: 0;
    padding: 8px 14px;
}

.integrated .player-controls {
    white-space: nowrap;
}

.integrated .volume-row {
    min-width: 0;
    padding: 8px 16px;
}

.integrated .playlist {
    max-height: 160px;
}

/* コンパクトモードではチャットヘッダー直下の1行だけを表示する */
.music-widget.compact {
    z-index: 30;
    display: block;
    overflow: hidden;
    border-radius: 8px;
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}

.compact-player-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px 34px;
    align-items: center;
    height: 100%;
    padding: 2px 5px 2px 10px;
    box-sizing: border-box;
}

.compact-track-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0;
    overflow: hidden;
    background: transparent;
    color: #475569;
    text-align: left;
}

.compact-track-title i {
    flex: 0 0 auto;
    color: #8b5cf6;
    font-size: 12px;
}

.compact-track-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
}

.compact-control {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: transparent;
    color: #64748b;
}

.compact-control:hover:not(:disabled) {
    background: #f3e8ff;
    color: #7c3aed;
}

.compact-control:disabled {
    opacity: 0.35;
    cursor: default;
}

@media (max-width: 760px) {
    .music-widget.integrated {
        grid-template-columns: minmax(150px, 1fr) auto;
    }

    .integrated .progress-row,
    .integrated .volume-row {
        grid-column: 1 / -1;
    }
}
</style>
