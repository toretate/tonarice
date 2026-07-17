<script setup lang="ts">
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useMusicStore } from '../../store/music';

const musicStore = useMusicStore();
const { opacity, volume, playlistExpanded } = storeToRefs(musicStore);

onMounted(() => {
    if (!musicStore.isLoaded) musicStore.loadFromLocalStorage();
});
</script>

<template>
    <section class="music-settings-panel">
        <header class="panel-heading">
            <div class="heading-icon"><i class="pi pi-headphones"></i></div>
            <div>
                <h1>音楽ウィジェット</h1>
                <p>音楽再生ウィジェットの表示と再生初期値を設定します。</p>
            </div>
        </header>

        <div class="settings-card">
            <div class="setting-row">
                <div class="setting-description">
                    <label for="music-opacity">ウィジェットの透明度</label>
                    <span>背景を透かしてマスコット画面になじませます。</span>
                </div>
                <div class="range-control">
                    <input id="music-opacity" v-model.number="opacity" type="range" min="0.2" max="1" step="0.05" />
                    <output>{{ Math.round(opacity * 100) }}%</output>
                </div>
            </div>

            <div class="setting-row">
                <div class="setting-description">
                    <label for="music-volume">初期音量</label>
                    <span>音楽ウィジェットで使用する再生音量です。</span>
                </div>
                <div class="range-control">
                    <input id="music-volume" v-model.number="volume" type="range" min="0" max="1" step="0.05" />
                    <output>{{ Math.round(volume * 100) }}%</output>
                </div>
            </div>

            <label class="toggle-row">
                <div class="setting-description">
                    <span class="toggle-title">プレイリストを展開して表示</span>
                    <span>オフの場合、曲一覧は折り畳んだ状態で表示します。</span>
                </div>
                <input v-model="playlistExpanded" type="checkbox" />
            </label>
        </div>

        <div class="notice-card">
            <i class="pi pi-info-circle"></i>
            <span>選択した音楽フォルダとプレイリストはアプリ終了後に保持されません。</span>
        </div>
    </section>
</template>

<style scoped>
.music-settings-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    color: #334155;
}

.panel-heading {
    display: flex;
    align-items: center;
    gap: 14px;
}

.heading-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: #f3e8ff;
    color: #7c3aed;
    font-size: 20px;
}

.panel-heading h1 {
    margin: 0 0 4px;
    font-size: 22px;
}

.panel-heading p,
.setting-description span {
    margin: 0;
    color: #64748b;
    font-size: 13px;
}

.settings-card {
    overflow: hidden;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    background: #ffffff;
    box-shadow: 0 4px 20px rgba(15, 23, 42, 0.05);
}

.setting-row,
.toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
    min-height: 82px;
    padding: 16px 20px;
    border-bottom: 1px solid #f1f5f9;
    box-sizing: border-box;
}

.toggle-row {
    border-bottom: 0;
    cursor: pointer;
}

.setting-description {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.setting-description label,
.toggle-title {
    color: #334155 !important;
    font-size: 14px !important;
    font-weight: 700;
}

.range-control {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 250px;
}

.range-control input {
    flex: 1;
    accent-color: #8b5cf6;
}

.range-control output {
    width: 42px;
    color: #7c3aed;
    font-size: 13px;
    font-weight: 700;
    text-align: right;
}

.toggle-row input {
    width: 20px;
    height: 20px;
    accent-color: #8b5cf6;
}

.notice-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid #ddd6fe;
    border-radius: 10px;
    background: #faf5ff;
    color: #6d28d9;
    font-size: 12px;
}
</style>
