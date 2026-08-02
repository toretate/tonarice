<script setup lang="ts">
import { ref } from 'vue';
import Card from 'primevue/card';
import Select from 'primevue/select';
import Button from 'primevue/button';
import { useConfigStore } from '@/store/config';
import { storeToRefs } from 'pinia';

const configStore = useConfigStore();
const {
    selectedImageEngine,
    openaiImageModel,
    openaiImageQuality,
    openaiImageSize,
    openaiImageBackground,
    forgeEndpoint,
    forgeModel,
    forgeLora,
    forgeModelsList,
    forgeLorasList,
    forgeDebugLog
} = storeToRefs(configStore);

const imageEngines = ref([
    { name: 'OpenAI GPT Image', value: 'openai_image' },
    { name: 'Stable Diffusion Forge (ローカル)', value: 'sd_forge' }
]);

const openaiModels = [
    { name: 'GPT Image 2（推奨）', value: 'gpt-image-2' }
];
const openaiQualities = [
    { name: '自動', value: 'auto' },
    { name: '低', value: 'low' },
    { name: '中', value: 'medium' },
    { name: '高', value: 'high' }
];
const openaiSizes = [
    { name: '正方形（1024 × 1024）', value: '1024x1024' },
    { name: '縦長（1024 × 1536）', value: '1024x1536' },
    { name: '横長（1536 × 1024）', value: '1536x1024' },
    { name: '自動', value: 'auto' }
];
const openaiBackgrounds = [
    { name: '自動', value: 'auto' },
    { name: '不透明', value: 'opaque' }
];

const saveStatus = ref('設定を保存');
const isSaving = ref(false);

// Forge 用の状態
const connectionStatus = ref('');
const isTestingConnection = ref(false);
const isLoadingModels = ref(false);
const isLoadingLoras = ref(false);

const testConnection = async () => {
    if (!window.electronAPI) return;
    isTestingConnection.value = true;
    connectionStatus.value = '接続確認中...';
    try {
        const ok = await window.electronAPI.forgeTestConnection(forgeEndpoint.value);
        if (ok) {
            connectionStatus.value = '接続成功！';
        } else {
            connectionStatus.value = '接続失敗（起動していない可能性があります）';
        }
    } catch (e: any) {
        connectionStatus.value = `接続エラー: ${e.message}`;
    } finally {
        isTestingConnection.value = false;
    }
};

const loadModels = async () => {
    if (!window.electronAPI) return;
    isLoadingModels.value = true;
    try {
        const models = await window.electronAPI.forgeGetModels(forgeEndpoint.value);
        if (models && models.length > 0) {
            forgeModelsList.value = models;
            await configStore.saveConfig();
            alert(`モデル一覧をロードしました (${models.length} 個)`);
        } else {
            alert('モデル一覧を取得できませんでした。サーバー接続を確認してください。');
        }
    } catch (e: any) {
        alert(`モデル取得エラー: ${e.message}`);
    } finally {
        isLoadingModels.value = false;
    }
};

const loadLoras = async () => {
    if (!window.electronAPI) return;
    isLoadingLoras.value = true;
    try {
        const loras = await window.electronAPI.forgeGetLoras(forgeEndpoint.value);
        if (loras && loras.length > 0) {
            forgeLorasList.value = loras;
            await configStore.saveConfig();
            alert(`LoRA一覧をロードしました (${loras.length} 個)`);
        } else {
            alert('LoRA一覧を取得できませんでした。サーバー接続または設定を確認してください。');
        }
    } catch (e: any) {
        alert(`LoRA取得エラー: ${e.message}`);
    } finally {
        isLoadingLoras.value = false;
    }
};

const saveSettings = async () => {
    isSaving.value = true;
    saveStatus.value = '保存中...';
    try {
        await configStore.saveConfig();
        setTimeout(() => {
            saveStatus.value = '保存完了！';
            isSaving.value = false;
            setTimeout(() => {
                saveStatus.value = '設定を保存';
            }, 2000);
        }, 600);
    } catch (e) {
        saveStatus.value = '保存エラー';
        isSaving.value = false;
    }
};
</script>

<template>
    <Card class="premium-card">
        <template #title>画像生成AI設定</template>
        <template #content>
            <div class="flex flex-column gap-4">
                <div class="form-field">
                    <label class="font-medium">画像生成AIエンジン</label>
                    <Select 
                        v-model="selectedImageEngine" 
                        :options="imageEngines" 
                        optionLabel="name" 
                        optionValue="value" 
                        class="w-full" 
                    />
                </div>

                <fieldset v-if="selectedImageEngine === 'openai_image'" class="flex flex-column gap-3 p-3 bg-slate-50 border-round border-1 border-gray-200 mt-2">
                    <legend class="font-medium text-sm text-slate-700 px-1">OpenAI GPT Image 2 設定</legend>
                    <div class="openai-mode-notes" aria-label="GPT Image 2 のモード別仕様">
                        <p><strong>t2i:</strong> テキストから新しい画像を生成します。</p>
                        <p><strong>i2i:</strong> 入力画像を常に高忠実度で参照します。Denoise設定はなく、変更量はプロンプトで指定します。</p>
                    </div>
                    <div class="form-field flex flex-column gap-1">
                        <label for="openai-image-model" class="font-medium text-sm text-slate-700">モデル</label>
                        <Select id="openai-image-model" v-model="openaiImageModel" :options="openaiModels" optionLabel="name" optionValue="value" class="w-full" />
                    </div>
                    <div class="form-field flex flex-column gap-1">
                        <label for="openai-image-quality" class="font-medium text-sm text-slate-700">品質</label>
                        <Select id="openai-image-quality" v-model="openaiImageQuality" :options="openaiQualities" optionLabel="name" optionValue="value" class="w-full" />
                    </div>
                    <div class="form-field flex flex-column gap-1">
                        <label for="openai-image-size" class="font-medium text-sm text-slate-700">画像サイズ</label>
                        <Select id="openai-image-size" v-model="openaiImageSize" :options="openaiSizes" optionLabel="name" optionValue="value" class="w-full" />
                    </div>
                    <div class="form-field flex flex-column gap-1">
                        <label for="openai-image-background" class="font-medium text-sm text-slate-700">背景</label>
                        <Select id="openai-image-background" v-model="openaiImageBackground" :options="openaiBackgrounds" optionLabel="name" optionValue="value" class="w-full" aria-describedby="openai-image-background-help" />
                        <small id="openai-image-background-help" class="text-slate-500">GPT Image 2は透過背景に対応していません。</small>
                    </div>
                    <small class="text-slate-500">APIキーは「API KEY設定」のOpenAI欄を使用します。</small>
                </fieldset>

                <!-- Stable Diffusion Forge 専用設定 -->
                <div v-if="selectedImageEngine === 'sd_forge'" class="flex flex-column gap-3 p-3 bg-slate-50 border-round border-1 border-gray-200 mt-2">
                    <div class="form-field flex flex-column gap-1">
                        <label class="font-medium text-sm text-slate-700">接続先 URL</label>
                        <div class="flex gap-2">
                            <input 
                                v-model="forgeEndpoint" 
                                type="text" 
                                class="flex-1 p-2 border-round border-1 border-gray-300 text-sm focus:outline-none focus:border-brand-400"
                                placeholder="http://127.0.0.1:5555"
                            />
                            <Button 
                                :label="isTestingConnection ? '確認中...' : '接続確認'" 
                                icon="pi pi-link" 
                                class="p-button-outlined p-button-secondary p-button-sm" 
                                :disabled="isTestingConnection"
                                @click="testConnection"
                            />
                        </div>
                        <span v-if="connectionStatus" class="text-xs text-slate-500 font-bold mt-1">{{ connectionStatus }}</span>
                    </div>

                    <div class="form-field flex flex-column gap-1">
                        <label class="font-medium text-sm text-slate-700">デフォルトモデル</label>
                        <div class="flex gap-2 align-items-center">
                            <Select 
                                v-model="forgeModel" 
                                :options="forgeModelsList" 
                                editable 
                                class="flex-1 text-sm" 
                                placeholder="sd_model.safetensors など（空欄でデフォルト）"
                            />
                            <Button 
                                :label="isLoadingModels ? 'ロード中...' : 'モデル取得'" 
                                icon="pi pi-refresh" 
                                class="p-button-outlined p-button-info p-button-sm shrink-0" 
                                :disabled="isLoadingModels"
                                @click="loadModels"
                            />
                        </div>
                    </div>

                    <div class="form-field flex flex-column gap-1">
                        <label class="font-medium text-sm text-slate-700">デフォルト LoRA</label>
                        <div class="flex gap-2 align-items-center">
                            <Select 
                                v-model="forgeLora" 
                                :options="forgeLorasList" 
                                editable 
                                class="flex-1 text-sm" 
                                placeholder="LoRA名（空欄でデフォルト）"
                            />
                            <Button 
                                :label="isLoadingLoras ? 'ロード中...' : 'LoRA取得'" 
                                icon="pi pi-refresh" 
                                class="p-button-outlined p-button-info p-button-sm shrink-0" 
                                :disabled="isLoadingLoras"
                                @click="loadLoras"
                            />
                        </div>
                    </div>

                    <!-- デバッグログ出力設定 -->
                    <div class="form-field flex align-items-center gap-2 mt-3 select-none">
                        <input 
                            v-model="forgeDebugLog" 
                            type="checkbox" 
                            id="forgeDebugLog"
                            class="cursor-pointer"
                        />
                        <label for="forgeDebugLog" class="font-medium text-sm text-slate-700 cursor-pointer">
                            API送信リクエストのデバッグログを出力する（ターミナルに表示）
                        </label>
                    </div>
                </div>
                <div class="flex justify-content-end mt-4">
                    <Button 
                        :label="saveStatus" 
                        :icon="saveStatus === '保存完了！' ? 'pi pi-check-circle' : 'pi pi-check'" 
                        class="p-button-primary" 
                        :disabled="isSaving"
                        @click="saveSettings" 
                    />
                </div>
            </div>
        </template>
    </Card>
</template>

<style scoped>
.openai-mode-notes {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--color-primary-alpha-15);
    border-radius: 8px;
    background: var(--color-primary-alpha-06);
    color: #475569;
    font-size: 12px;
    line-height: 1.5;
}

.openai-mode-notes p {
    margin: 0;
}
</style>
