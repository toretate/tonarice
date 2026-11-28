<script setup lang="ts">
import { createAuthClient } from 'better-auth/client';
import { electronProxyClient } from '@better-auth/electron/proxy';
import { onMounted, onUnmounted, ref } from 'vue';
import { electronAuthScheme } from '../../utils/electron-auth-protocol';

const returnToApp = ref('');
let transferTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
    const auth = createAuthClient({ plugins: [electronProxyClient({ protocol: electronAuthScheme })] });
    const code = auth.electron.getAuthorizationCode();
    if (!code) return;
    returnToApp.value = `${electronAuthScheme}://auth/callback#token=${encodeURIComponent(code)}`;
    transferTimer = auth.ensureElectronRedirect();
});

onUnmounted(() => clearInterval(transferTimer));
</script>

<template>
    <main class="fallback-view">
        <template v-if="returnToApp">
            <h1>Google 認証が完了しました</h1>
            <p>ブラウザーに確認が表示されたら、tonarice を開いてください。</p>
            <a :href="returnToApp">tonarice を開く</a>
        </template>
        <template v-else>
            <h1>tonarice のログイン</h1>
            <p>アプリでログイン状態を確認してください。未ログインの場合は、アプリからやり直してください。</p>
        </template>
    </main>
</template>
