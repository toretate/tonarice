<script setup lang="ts">
import type { MarkdownInlineNode } from '../../utils/markdown-message';

defineProps<{ nodes: MarkdownInlineNode[] }>();
</script>

<template>
    <template v-for="(node, index) in nodes" :key="index">
        <strong v-if="node.type === 'strong'">{{ node.text }}</strong>
        <em v-else-if="node.type === 'emphasis'">{{ node.text }}</em>
        <code v-else-if="node.type === 'code'">{{ node.text }}</code>
        <s v-else-if="node.type === 'strike'">{{ node.text }}</s>
        <a v-else-if="node.type === 'link' && node.href" :href="node.href" target="_blank" rel="noopener noreferrer">{{ node.text }}</a>
        <span v-else>{{ node.text }}</span>
    </template>
</template>
