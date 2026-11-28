<script setup lang="ts">
import { ref, watch } from 'vue';
import { changeCompanionMemory, loadCompanionMemory } from '../../../utils/companion-memory-client';

const props = defineProps<{ mascotId: string; disabled?: boolean }>();
const emit = defineEmits<{ undoPending: [boolean]; undoDone: [] }>();
const state = ref<Awaited<ReturnType<typeof loadCompanionMemory>>>();
const status = ref('');
const busy = ref(false);
let request = 0;

watch(() => props.mascotId, async mascotId => {
    const current = ++request;
    state.value = undefined;
    status.value = '';
    busy.value = true;
    try {
        const result = await loadCompanionMemory(mascotId);
        if (current === request) state.value = result;
    } catch {
        if (current === request) status.value = '記憶設定を読み込めませんでした。';
    } finally {
        if (current === request) busy.value = false;
    }
}, { immediate: true });

async function update(action: Parameters<typeof changeCompanionMemory>[1]) {
    if (busy.value || props.disabled) return;
    const current = ++request;
    const undo = 'undoId' in action;
    if (undo) emit('undoPending', true);
    busy.value = true;
    status.value = '';
    try {
        const result = await changeCompanionMemory(props.mascotId, action);
        if (current !== request) return;
        state.value = result;
        status.value = undo ? '記憶の更新を元に戻しました。' : '記憶設定を更新しました。';
        if (undo) emit('undoDone');
    } catch (error) {
        if (current === request) status.value = error instanceof Error ? error.message : '記憶設定を更新できませんでした。';
    } finally {
        if (current === request) {
            busy.value = false;
            if (undo) emit('undoPending', false);
        }
    }
}
</script>

<template>
    <section class="prompt-section p-3 bg-slate-50 border-round border-1 border-gray-200" aria-label="伴走記憶">
        <h3 class="text-sm font-bold mt-0 mb-2">伴走記憶</h3>
        <template v-if="state">
            <label class="flex gap-2 align-items-center">
                <input type="checkbox" :checked="state.enabled" :disabled="busy || disabled"
                    @change="update({ enabled: ($event.target as HTMLInputElement).checked })">
                会話から記憶を自動更新
            </label>
            <p v-if="state.reasons.includes('pending_credentials')" class="text-sm">
                サーバーで選択中のチャット AI のキーまたは接続設定を利用できないため、抽出を保留しています。
            </p>
            <p v-if="state.reasons.includes('needs_review')" class="text-sm">
                既存の記憶を変更する提案を保留しました。必要な内容は編集欄で調整できます。
            </p>
            <p v-if="state.reasons.includes('failed')" class="text-sm">
                一部の会話は、3回試しても抽出できなかったため処理を終了しました。
            </p>
            <h4 class="text-sm mb-1">今の気がかり</h4>
            <ul v-if="state.concerns.length" class="m-0 pl-4">
                <li v-for="concern in state.concerns" :key="concern.id" class="mb-1">
                    {{ concern.text }}
                    <button type="button" :disabled="busy || disabled" :aria-label="`気がかりを削除 ${concern.text}`"
                        @click="update({ deleteId: concern.id })">×</button>
                </li>
            </ul>
            <p v-else class="text-sm my-1">気がかりはありません。</p>
            <button v-if="state.revision" type="button" :disabled="busy || disabled"
                @click="update({ undoId: state.revision.id })">前回の記憶更新を元に戻す</button>
        </template>
        <p v-if="status" role="status" class="text-sm mb-0">{{ status }}</p>
    </section>
</template>
