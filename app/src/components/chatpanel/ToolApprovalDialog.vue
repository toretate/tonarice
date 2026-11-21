<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { describeToolApproval, toolApprovalLabels, type ToolApprovalRequest } from './tool-approval-display';

const props = defineProps<{ request: ToolApprovalRequest | null; canRemember: boolean }>();
const emit = defineEmits<{ decide: [choice: 'deny' | 'approve' | 'remember'] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const description = computed(() => props.request ? describeToolApproval(props.request) : null);
watch(() => props.request, async request => {
    await nextTick();
    if (request && dialog.value && !dialog.value.open) dialog.value.showModal();
    else if (!request && dialog.value?.open) dialog.value.close();
}, { immediate: true });

function onClose() {
    if (!dialog.value) return;
    const choice = dialog.value.returnValue;
    dialog.value.returnValue = '';
    if (props.request) emit('decide', choice === 'approve' || choice === 'remember' ? choice : 'deny');
}
</script>

<template>
    <dialog ref="dialog" class="tool-approval" aria-labelledby="tool-approval-title" @close="onClose">
        <h2 id="tool-approval-title">{{ description?.title }}</h2>
        <dl v-if="description?.fields.length" class="tool-approval-fields">
            <template v-for="(field, index) in description.fields" :key="index">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
            </template>
        </dl>
        <p>内容を確認してから選択してください。対象の表示情報は最新でない場合があります。時間切れの場合は実行しません。</p>
        <p v-if="request && toolApprovalLabels[request.name]" class="tool-approval-note">
            確認を省略すると、今後このツールのすべての操作（変更・削除を含む）が確認なしで実行されます。ツール設定から元に戻せます。
        </p>
        <form method="dialog" class="tool-approval-actions">
            <button type="submit" value="deny" autofocus>キャンセル</button>
            <button v-if="request && toolApprovalLabels[request.name]" type="submit" value="remember" :disabled="!canRemember">今回実行して今後確認しない</button>
            <button type="submit" value="approve">今回のみ実行</button>
        </form>
    </dialog>
</template>

<style scoped>
.tool-approval { max-width: min(36rem, 92vw); max-height: 85vh; border: 1px solid var(--color-primary); border-radius: 1rem; padding: 1.25rem; background: var(--surface-card, white); color: var(--text-color, black); }
.tool-approval:modal { overscroll-behavior: contain; }
.tool-approval::backdrop { background: rgb(0 0 0 / 45%); overflow: hidden; overscroll-behavior: contain; }
.tool-approval h2 { margin: 0 0 1rem; font-size: 1.1rem; }
.tool-approval-fields { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .5rem 1rem; }
.tool-approval-fields dt { font-weight: bold; }
.tool-approval-fields dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-approval-note { font-size: .85rem; }
.tool-approval-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
.tool-approval-actions button { padding: .5rem .75rem; border: 1px solid var(--color-primary); border-radius: .5rem; background: var(--surface-card, white); color: var(--text-color, black); cursor: pointer; }
</style>
