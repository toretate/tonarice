<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue';
import type { CoWorkAiEngine, CoWorkAiSettings, CoWorkAiSettingsInput, CoWorkModelCatalog } from '../../types/cowork-ai-settings';
import { CoWorkApiError, requestCoWork } from './cowork-api';

const props = defineProps<{ scope: string }>();
const emit = defineEmits<{ reloadAccount: [] }>();
const formId = useId();
const heading = ref<HTMLHeadingElement | null>(null);
const labels = { gemini: 'Gemini', openai: 'OpenAI', lmstudio: 'LM Studio' } satisfies Record<CoWorkAiEngine, string>;
const sourceLabels = { saved: 'このアカウントの設定', server: 'サーバーの既定値', environment: 'サーバーの環境変数' };
const settings = ref<CoWorkAiSettings>();
const engine = ref<CoWorkAiEngine>('gemini');
const model = ref('');
const busy = ref(false);
const errorMessage = ref('');
const feedback = ref('');
const catalog = ref<CoWorkModelCatalog>();
const catalogLoading = ref(false);
const catalogRevision = ref(0);
const manualModel = ref(false);
const modelOptions = computed(() => {
    const models = catalog.value?.models ?? [];
    return model.value && !models.includes(model.value) ? [model.value, ...models] : models;
});
let session: AbortController | undefined;

onMounted(() => heading.value?.focus());

function applySettings(next: CoWorkAiSettings) {
    settings.value = next;
    engine.value = next.engine ?? 'gemini';
    model.value = next.model;
    manualModel.value = false;
}

async function requestSettings(method = 'GET', input?: CoWorkAiSettingsInput) {
    const signal = session?.signal;
    if (!signal || !props.scope || busy.value) return;
    busy.value = true;
    feedback.value = '';
    errorMessage.value = '';
    try {
        const next = await requestCoWork<CoWorkAiSettings>('/settings', { method, body: input, signal, scope: props.scope });
        if (signal.aborted) return;
        applySettings(next);
        if (method !== 'GET') feedback.value = method === 'PUT' ? '設定を保存しました。' : 'サーバーの既定値に戻しました。';
    } catch (error) {
        if (signal.aborted) return;
        if (error instanceof CoWorkApiError && [401, 403, 409].includes(error.status)) {
            settings.value = undefined;
            emit('reloadAccount');
        }
        errorMessage.value = error instanceof Error ? error.message : 'AI 設定を読み込めませんでした。';
    } finally {
        if (!signal.aborted) busy.value = false;
    }
}

watch(() => props.scope, (_scope, _previousScope, onCleanup) => {
    const controller = new AbortController();
    session = controller;
    onCleanup(() => controller.abort());
    settings.value = undefined;
    engine.value = 'gemini';
    model.value = '';
    busy.value = false;
    feedback.value = '';
    errorMessage.value = '';
    void requestSettings();
}, { immediate: true });

watch([() => props.scope, engine, () => Boolean(settings.value), catalogRevision], async ([scope, service, loaded], _, onCleanup) => {
    catalog.value = undefined;
    catalogLoading.value = false;
    if (!scope || !loaded) return;

    const controller = new AbortController();
    onCleanup(() => controller.abort());
    catalogLoading.value = true;
    try {
        const result = await requestCoWork<CoWorkModelCatalog>('/models', {
            method: 'POST', body: { engine: service }, scope, signal: controller.signal
        });
        if (controller.signal.aborted) return;
        catalog.value = result;
        if (!model.value && result.preferredModel) model.value = result.preferredModel;
    } catch {
        if (!controller.signal.aborted) catalog.value = { models: [], preferredModel: '', status: 'unavailable' };
    } finally {
        if (!controller.signal.aborted) catalogLoading.value = false;
    }
}, { flush: 'post' });

function changeEngine() {
    model.value = '';
    manualModel.value = false;
}

function save() {
    const input: CoWorkAiSettingsInput = { engine: engine.value, model: model.value };
    void requestSettings('PUT', input);
}
</script>

<template>
    <section class="settings-section" :aria-labelledby="`${formId}-title`" :aria-busy="busy">
        <header class="settings-heading">
            <h2 :id="`${formId}-title`" ref="heading" tabindex="-1">CoWork の設定</h2>
        </header>

        <p v-if="!scope">設定を表示するには、CoWork にログインしてください。</p>
        <p v-else-if="busy && !settings" role="status">AI 設定を読み込んでいます。</p>
        <template v-if="settings">
            <form class="ai-settings-form" @submit.prevent="save">
                <fieldset class="fields" :disabled="busy">
                    <legend>実行に使う AI</legend>

                    <label :for="`${formId}-engine`">AI サービス</label>
                    <select :id="`${formId}-engine`" v-model="engine" name="engine" @change="changeEngine">
                        <option v-for="(label, value) in labels" :key="value" :value="value">{{ label }}</option>
                    </select>

                    <label :for="`${formId}-model`">モデル ID</label>
                    <select
                        v-if="catalog?.models.length && !manualModel"
                        :id="`${formId}-model`"
                        v-model="model"
                        name="model"
                        required
                    >
                        <option value="" disabled>モデルを選択</option>
                        <option v-for="id in modelOptions" :key="id" :value="id">{{ id }}</option>
                    </select>
                    <input
                        v-else
                        :id="`${formId}-model`"
                        v-model.trim="model"
                        name="model"
                        spellcheck="false"
                        required
                        maxlength="256"
                    >

                    <small v-if="catalogLoading" role="status">モデル一覧を読み込んでいます。</small>
                    <small v-else-if="catalog?.status === 'missing-key'" role="status">
                        一覧を取得するには、接続先のメイン設定で「APIキー」を登録してください。
                    </small>
                    <small v-else-if="catalog?.status === 'unavailable'" role="status">
                        モデル一覧を取得できませんでした。モデル ID は手入力できます。
                    </small>
                    <small v-else-if="catalog?.models.length === 0" role="status">候補がありません。モデル ID を入力してください。</small>
                    <div class="settings-actions catalog-actions">
                        <button v-if="catalog?.models.length" type="button" @click="manualModel = !manualModel">
                            {{ manualModel ? '一覧から選ぶ' : 'モデル ID を手入力' }}
                        </button>
                        <button v-if="catalog && !catalogLoading" type="button" @click="catalogRevision += 1">
                            モデル一覧を更新
                        </button>
                    </div>
                </fieldset>

                <div class="settings-actions">
                    <button type="submit" class="save-button" :disabled="busy">設定を保存</button>
                    <button v-if="settings.source === 'saved'" type="button" :disabled="busy" @click="requestSettings('DELETE')">
                        サーバーの既定値に戻す
                    </button>
                </div>
            </form>
            <dl class="settings-summary">
                <div><dt>AI の設定</dt><dd>{{ settings.configured ? '設定済み' : '未設定' }}</dd></div>
                <div><dt>設定元</dt><dd>{{ sourceLabels[settings.source] }}</dd></div>
                <div v-if="settings.engine && settings.engine !== 'lmstudio'">
                    <dt>使用できる API キー</dt><dd>{{ settings.hasApiKey ? 'あり' : 'なし' }}</dd>
                </div>
            </dl>
        </template>
        <p v-if="errorMessage" class="settings-error" role="alert">{{ errorMessage }}</p>
        <div v-if="scope && ((!settings && errorMessage) || (settings?.engine && settings.engine !== 'lmstudio' && !settings.hasApiKey))">
            <button type="button" :disabled="busy" @click="requestSettings()">設定状態を再読み込み</button>
        </div>
        <p v-if="feedback" role="status">{{ feedback }}</p>
    </section>
</template>

<style scoped>
.settings-section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    max-inline-size: 640px;
    overflow-wrap: anywhere;
}

.settings-section p,
.settings-section dl,
.settings-heading h2 {
    margin: 0;
}

small,
dt {
    color: var(--cowork-muted);
}

.settings-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
    padding: 12px 16px;
    border: 1px solid var(--cowork-border);
    border-radius: var(--cowork-radius);
    background: var(--cowork-surface-muted);
}

dd {
    margin: 0;
    font-weight: 600;
}

.ai-settings-form,
.fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
}

.fields {
    min-inline-size: 0;
    margin: 0;
    padding: 12px 16px 16px;
    border: 1px solid var(--cowork-border);
    border-radius: var(--cowork-radius);
    background: var(--cowork-surface);
}

legend,
label {
    font-weight: 600;
}

button,
input,
select {
    min-block-size: 44px;
    box-sizing: border-box;
    padding: 8px 12px;
    border: 1px solid var(--cowork-border);
    border-radius: 8px;
    background: var(--cowork-surface);
    color: var(--cowork-ink);
    font: inherit;
}

input,
select {
    inline-size: 100%;
}

button {
    cursor: pointer;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

:is(button, input, select):focus-visible {
    outline: 3px solid var(--cowork-focus);
    outline-offset: 2px;
}

.save-button {
    background: var(--cowork-accent);
    color: var(--cowork-accent-ink);
}

.settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.catalog-actions:empty {
    display: none;
}

.catalog-actions button {
    min-block-size: 36px;
    padding: 5px 8px;
    font-size: 0.8125rem;
}

.settings-error {
    color: var(--cowork-danger);
}
</style>
