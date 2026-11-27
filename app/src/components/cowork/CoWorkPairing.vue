<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { requestCoWork } from './cowork-api';

const props = defineProps<{ scope: string }>();
const emit = defineEmits<{ paired: [] }>();
const desktop = ref(false);
const issuedCode = ref('');
const enteredCode = ref('');
const feedback = ref('');
const busy = ref(false);

onMounted(() => { desktop.value = Boolean(window.electronAPI?.pairCoWork); });

const perform = async (operation: () => Promise<void>) => {
    if (busy.value) return;
    busy.value = true;
    feedback.value = '';
    try {
        await operation();
    } catch (error) {
        feedback.value = error instanceof Error ? error.message : 'デスクトップ版との接続に失敗しました。';
    } finally {
        busy.value = false;
    }
};

const issueCode = () => perform(async () => {
    issuedCode.value = '';
    const { code } = await requestCoWork<{ code: string }>('/pair', { method: 'POST', scope: props.scope });
    issuedCode.value = code;
});

const openPairing = () => perform(async () => {
    await window.electronAPI?.openCoWorkPairing?.();
});

const pair = () => perform(async () => {
    if (!await window.electronAPI?.pairCoWork?.(enteredCode.value)) {
        feedback.value = '接続コードが無効か、期限切れです。';
        return;
    }
    enteredCode.value = '';
    emit('paired');
});
</script>

<template>
    <details v-if="desktop || scope">
        <summary>{{ desktop ? 'CoWork のアカウントを接続する' : 'デスクトップ版を接続する' }}</summary>
        <form v-if="desktop" @submit.prevent="pair">
            <p>接続先をブラウザーで開いてログインし、CoWork のスケジュール画面で接続コードを発行してください。</p>
            <button type="button" :disabled="busy" @click="openPairing">接続先を開く</button>
            <label for="cowork-pair-code">接続コード</label>
            <input id="cowork-pair-code" v-model.trim="enteredCode" autocomplete="off" maxlength="43" required>
            <button type="submit" :disabled="busy || enteredCode.length !== 43">接続</button>
        </form>
        <template v-else>
            <button type="button" :disabled="busy" @click="issueCode">接続コードを発行</button>
            <div v-if="issuedCode">
                <label for="cowork-issued-code">5分以内にデスクトップ版に貼り付けてください。</label>
                <input id="cowork-issued-code" :value="issuedCode" readonly @focus="($event.target as HTMLInputElement).select()">
            </div>
        </template>
        <p v-if="feedback" role="status">{{ feedback }}</p>
    </details>
</template>
