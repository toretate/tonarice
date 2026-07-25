<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import type {
    ScheduleRule,
    ScheduledPromptRun,
    ScheduledPromptTask,
    ScheduledPromptTaskInput
} from '../../types/scheduled-prompt-task';

const tasks = ref<ScheduledPromptTask[]>([]);
const runs = ref<ScheduledPromptRun[]>([]);
const loading = ref(true);
const submitting = ref(false);
const readOnly = ref(false);
const errorMessage = ref('');
const showForm = ref(false);
const editingId = ref<string | null>(null);
const activeSection = ref<'overview' | 'schedule'>('overview');
let unsubscribeChanged: (() => void) | undefined;

const form = reactive({
    name: '',
    prompt: '',
    scheduleType: 'daily' as ScheduleRule['type'],
    interval: 1,
    time: '09:00',
    minute: 0,
    weekdays: [1] as number[],
    enabled: true
});

const weekdayOptions = [
    { value: 0, label: '日' },
    { value: 1, label: '月' },
    { value: 2, label: '火' },
    { value: 3, label: '水' },
    { value: 4, label: '木' },
    { value: 5, label: '金' },
    { value: 6, label: '土' }
];

const enabledTasks = computed(() => tasks.value.filter((task) => task.enabled));
const nearestRunAt = computed(() => enabledTasks.value
    .map((task) => task.nextRunAt)
    .sort()[0]);

const formatDateTime = (iso?: string) => iso
    ? new Intl.DateTimeFormat('ja-JP', {
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(new Date(iso))
    : '未実行';

const formatSchedule = (schedule: ScheduleRule) => {
    switch (schedule.type) {
        case 'interval':
            return `${schedule.intervalMinutes}分ごと`;
        case 'hourly':
            return `${schedule.intervalHours}時間ごと（${schedule.minute}分）`;
        case 'daily':
            return `${schedule.intervalDays}日ごと ${schedule.time}`;
        case 'weekly':
            return `${schedule.intervalWeeks}週ごと ${
                schedule.weekdays.map((day) => weekdayOptions[day].label).join('・')
            } ${schedule.time}`;
    }
};

const statusLabel = (status?: ScheduledPromptRun['status'] | ScheduledPromptTask['lastStatus']) => {
    if (!status) return '未実行';
    const labels: Record<NonNullable<typeof status>, string> = {
        running: '実行中',
        success: '成功',
        failed: '失敗',
        skipped: 'スキップ'
    };
    return labels[status];
};

const loadData = async () => {
    if (!window.electronAPI) return;
    try {
        const data = await window.electronAPI.getScheduledPromptData();
        tasks.value = data.tasks;
        runs.value = data.runs;
        readOnly.value = data.readOnly;
        errorMessage.value = '';
    } catch (error) {
        errorMessage.value = error instanceof Error
            ? error.message
            : '定期実行タスクを読み込めませんでした。';
    } finally {
        loading.value = false;
    }
};

const resetForm = () => {
    editingId.value = null;
    Object.assign(form, {
        name: '',
        prompt: '',
        scheduleType: 'daily',
        interval: 1,
        time: '09:00',
        minute: 0,
        weekdays: [1],
        enabled: true
    });
};

const openCreateForm = () => {
    resetForm();
    activeSection.value = 'schedule';
    showForm.value = true;
};

const openEditForm = (task: ScheduledPromptTask) => {
    activeSection.value = 'schedule';
    editingId.value = task.id;
    form.name = task.name;
    form.prompt = task.prompt;
    form.scheduleType = task.schedule.type;
    form.enabled = task.enabled;
    if (task.schedule.type === 'interval') {
        form.interval = task.schedule.intervalMinutes;
    } else if (task.schedule.type === 'hourly') {
        form.interval = task.schedule.intervalHours;
        form.minute = task.schedule.minute;
    } else if (task.schedule.type === 'daily') {
        form.interval = task.schedule.intervalDays;
        form.time = task.schedule.time;
    } else {
        form.interval = task.schedule.intervalWeeks;
        form.time = task.schedule.time;
        form.weekdays = [...task.schedule.weekdays];
    }
    showForm.value = true;
};

const buildSchedule = (): ScheduleRule => {
    switch (form.scheduleType) {
        case 'interval':
            return { type: 'interval', intervalMinutes: form.interval };
        case 'hourly':
            return { type: 'hourly', intervalHours: form.interval, minute: form.minute };
        case 'daily':
            return { type: 'daily', intervalDays: form.interval, time: form.time };
        case 'weekly':
            return {
                type: 'weekly',
                intervalWeeks: form.interval,
                weekdays: [...form.weekdays].sort(),
                time: form.time
            };
    }
};

const submitForm = async () => {
    if (!window.electronAPI || submitting.value) return;
    submitting.value = true;
    errorMessage.value = '';
    const input: ScheduledPromptTaskInput = {
        name: form.name,
        prompt: form.prompt,
        schedule: buildSchedule(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        enabled: form.enabled
    };

    try {
        const plainInput = JSON.parse(JSON.stringify(input));
        if (editingId.value) {
            await window.electronAPI.updateScheduledPromptTask(editingId.value, plainInput);
        } else {
            await window.electronAPI.createScheduledPromptTask(plainInput);
        }
        showForm.value = false;
        resetForm();
        await loadData();
    } catch (error) {
        errorMessage.value = error instanceof Error
            ? error.message
            : '定期実行タスクを保存できませんでした。';
    } finally {
        submitting.value = false;
    }
};

const toggleEnabled = async (task: ScheduledPromptTask) => {
    await window.electronAPI?.setScheduledPromptTaskEnabled(task.id, !task.enabled);
    await loadData();
};

const runNow = async (task: ScheduledPromptTask) => {
    errorMessage.value = '';
    try {
        await window.electronAPI?.runScheduledPromptTaskNow(task.id);
        await loadData();
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : '実行に失敗しました。';
    }
};

const deleteTask = async (task: ScheduledPromptTask) => {
    if (!window.confirm(`「${task.name}」を削除しますか？実行結果は残ります。`)) return;
    await window.electronAPI?.deleteScheduledPromptTask(task.id);
    await loadData();
};

onMounted(() => {
    void loadData();
    unsubscribeChanged = window.electronAPI?.onScheduledPromptChanged(() => {
        void loadData();
    });
});

onUnmounted(() => {
    unsubscribeChanged?.();
});
</script>

<template>
    <main class="cowork-panel">
        <aside class="cowork-sidebar">
            <div class="workspace-heading">
                <span class="workspace-mark" aria-hidden="true">C</span>
                <div class="workspace-copy">
                    <strong>CoWork</strong>
                    <small>作業スペース</small>
                </div>
            </div>

            <button type="button" class="primary-button new-task-button" aria-label="新しいタスク" :disabled="readOnly" @click="openCreateForm">
                <i class="pi pi-file-edit" aria-hidden="true"></i>
                <span class="sidebar-label">新しいタスク</span>
            </button>

            <nav aria-label="CoWork メニュー">
                <button
                    type="button"
                    class="nav-item"
                    aria-label="概要"
                    :class="{ active: activeSection === 'overview' }"
                    :aria-current="activeSection === 'overview' ? 'page' : undefined"
                    @click="activeSection = 'overview'"
                >
                    <i class="pi pi-th-large" aria-hidden="true"></i>
                    <span class="sidebar-label">概要</span>
                </button>
                <button
                    type="button"
                    class="nav-item"
                    aria-label="スケジュール"
                    :class="{ active: activeSection === 'schedule' }"
                    :aria-current="activeSection === 'schedule' ? 'page' : undefined"
                    @click="activeSection = 'schedule'"
                >
                    <i class="pi pi-clock" aria-hidden="true"></i>
                    <span class="sidebar-label">スケジュール</span>
                    <span v-if="tasks.length > 0" class="nav-count">{{ tasks.length }}</span>
                </button>
            </nav>

            <div class="sidebar-status">
                <span class="status-dot" :class="{ active: enabledTasks.length > 0 }" aria-hidden="true"></span>
                <span class="sidebar-label">{{ enabledTasks.length > 0 ? `${enabledTasks.length}件が稼働中` : '稼働中のタスクなし' }}</span>
            </div>
        </aside>

        <section class="cowork-content">
            <p v-if="readOnly" class="notice">この環境では定期実行タスクを編集できません。</p>
            <p class="live-message" aria-live="polite">{{ errorMessage }}</p>

            <template v-if="activeSection === 'overview'">
                <header class="content-header">
                    <div>
                        <p class="section-context">CoWork</p>
                        <h2>作業をまとめて進める</h2>
                        <p>定期的な確認や報告を、ひとつのワークスペースで管理します。</p>
                    </div>
                </header>

                <div class="overview-grid">
                    <button type="button" class="overview-action" @click="activeSection = 'schedule'">
                        <span class="overview-icon"><i class="pi pi-clock" aria-hidden="true"></i></span>
                        <span>
                            <strong>スケジュール</strong>
                            <small>プロンプトの定期実行と結果を管理</small>
                        </span>
                        <i class="pi pi-arrow-right" aria-hidden="true"></i>
                    </button>
                </div>

                <section class="activity-section" aria-labelledby="recent-activity-heading">
                    <div class="section-heading">
                        <h3 id="recent-activity-heading">最近の実行</h3>
                        <button v-if="runs.length > 0" type="button" class="text-button" @click="activeSection = 'schedule'">すべて表示</button>
                    </div>
                    <p v-if="runs.length === 0" class="empty-message">実行結果はまだありません。</p>
                    <article v-for="run in runs.slice(0, 3)" :key="run.id" class="activity-row">
                        <span class="activity-status" :data-status="run.status" aria-hidden="true"></span>
                        <div>
                            <strong>{{ run.taskName }}</strong>
                            <p>{{ run.resultText || run.errorMessage || '処理中です。' }}</p>
                        </div>
                        <time :datetime="run.startedAt">{{ formatDateTime(run.startedAt) }}</time>
                    </article>
                </section>
            </template>

            <template v-else>
                <header class="content-header schedule-header">
                    <div>
                        <p class="section-context">⏱ スケジュール</p>
                        <h2>定期実行タスク</h2>
                        <p>
                            有効 {{ enabledTasks.length }}件
                            <span v-if="nearestRunAt">・次回 {{ formatDateTime(nearestRunAt) }}</span>
                        </p>
                    </div>
                    <button type="button" class="primary-button header-action" :disabled="readOnly" @click="openCreateForm">
                        <i class="pi pi-plus" aria-hidden="true"></i>
                        タスクを作成
                    </button>
                </header>

                <form v-if="showForm" class="task-form" @submit.prevent="submitForm">
                    <div class="form-heading">
                        <div>
                            <p class="section-context">{{ editingId ? '編集' : '新規登録' }}</p>
                            <h3>{{ editingId ? '定期タスクを編集' : '定期タスクを作成' }}</h3>
                        </div>
                        <button type="button" class="icon-button" aria-label="フォームを閉じる" @click="showForm = false">
                            <i class="pi pi-times" aria-hidden="true"></i>
                        </button>
                    </div>

                    <div class="form-grid">
                        <div class="field full-field">
                            <label for="cowork-task-name">名前</label>
                            <input id="cowork-task-name" v-model.trim="form.name" name="name" required maxlength="100">
                        </div>

                        <div class="field full-field">
                            <label for="cowork-task-prompt">プロンプト</label>
                            <textarea id="cowork-task-prompt" v-model.trim="form.prompt" name="prompt" required maxlength="20000" rows="5"></textarea>
                        </div>

                        <fieldset class="full-field">
                            <legend>実行周期</legend>
                            <label><input v-model="form.scheduleType" type="radio" name="scheduleType" value="interval"> 指定間隔</label>
                            <label><input v-model="form.scheduleType" type="radio" name="scheduleType" value="hourly"> 毎時</label>
                            <label><input v-model="form.scheduleType" type="radio" name="scheduleType" value="daily"> 毎日</label>
                            <label><input v-model="form.scheduleType" type="radio" name="scheduleType" value="weekly"> 毎週</label>
                        </fieldset>

                        <div class="field">
                            <label for="cowork-task-interval">
                                {{ form.scheduleType === 'interval' ? '間隔（分）' : form.scheduleType === 'hourly' ? '間隔（時間）' : form.scheduleType === 'daily' ? '間隔（日）' : '間隔（週）' }}
                            </label>
                            <input
                                id="cowork-task-interval"
                                v-model.number="form.interval"
                                name="interval"
                                type="number"
                                :min="form.scheduleType === 'interval' ? 15 : 1"
                                required
                            >
                        </div>

                        <div v-if="form.scheduleType === 'hourly'" class="field">
                            <label for="cowork-task-minute">実行する分</label>
                            <input id="cowork-task-minute" v-model.number="form.minute" name="minute" type="number" min="0" max="59" required>
                        </div>

                        <div v-if="form.scheduleType === 'daily' || form.scheduleType === 'weekly'" class="field">
                            <label for="cowork-task-time">実行時刻</label>
                            <input id="cowork-task-time" v-model="form.time" name="time" type="time" required>
                        </div>

                        <fieldset v-if="form.scheduleType === 'weekly'" class="full-field">
                            <legend>曜日</legend>
                            <label v-for="weekday in weekdayOptions" :key="weekday.value">
                                <input v-model="form.weekdays" type="checkbox" name="weekdays" :value="weekday.value">
                                {{ weekday.label }}
                            </label>
                        </fieldset>

                        <label class="enabled-field full-field">
                            <input v-model="form.enabled" name="enabled" type="checkbox">
                            保存後すぐに有効にする
                        </label>
                    </div>

                    <div class="form-actions">
                        <button type="button" @click="showForm = false">キャンセル</button>
                        <button type="submit" class="primary-button" :disabled="submitting">
                            {{ submitting ? '保存中…' : '保存' }}
                        </button>
                    </div>
                </form>

                <section class="task-section" aria-labelledby="scheduled-task-heading">
                    <div class="section-heading">
                        <h3 id="scheduled-task-heading">登録済みタスク</h3>
                        <span>{{ tasks.length }}件</span>
                    </div>
                    <p v-if="loading">読み込み中…</p>
                    <p v-else-if="tasks.length === 0" class="empty-message">定期タスクはまだありません。</p>
                    <article v-for="task in tasks" :key="task.id" class="task-card">
                        <div class="task-card-heading">
                            <div>
                                <h4>{{ task.name }}</h4>
                                <p>{{ formatSchedule(task.schedule) }}</p>
                            </div>
                            <span class="status-label" :class="{ enabled: task.enabled }">{{ task.enabled ? '有効' : '無効' }}</span>
                        </div>
                        <div class="task-meta">
                            <span><i class="pi pi-calendar" aria-hidden="true"></i> 次回 {{ formatDateTime(task.nextRunAt) }}</span>
                            <span><i class="pi pi-check-circle" aria-hidden="true"></i> 最終 {{ formatDateTime(task.lastRunAt) }}・{{ statusLabel(task.lastStatus) }}</span>
                        </div>
                        <div class="card-actions">
                            <button type="button" @click="runNow(task)">今すぐ実行</button>
                            <button type="button" @click="openEditForm(task)">編集</button>
                            <button type="button" @click="toggleEnabled(task)">{{ task.enabled ? '無効化' : '有効化' }}</button>
                            <button type="button" class="danger-button" @click="deleteTask(task)">削除</button>
                        </div>
                    </article>
                </section>

                <section class="result-section" aria-labelledby="cowork-result-heading">
                    <div class="section-heading">
                        <h3 id="cowork-result-heading">実行結果</h3>
                        <span>{{ runs.length }}件</span>
                    </div>
                    <p v-if="runs.length === 0" class="empty-message">実行結果はまだありません。</p>
                    <article v-for="run in runs" :key="run.id" class="result-card">
                        <header>
                            <div>
                                <strong>{{ run.taskName }}</strong>
                                <p class="result-meta">{{ run.trigger === 'manual' ? '手動' : '定期' }}・{{ formatDateTime(run.startedAt) }}</p>
                            </div>
                            <span class="run-status" :data-status="run.status">{{ statusLabel(run.status) }}</span>
                        </header>
                        <p class="result-text">{{ run.resultText || run.errorMessage || '処理中です。' }}</p>
                    </article>
                </section>
            </template>
        </section>
    </main>
</template>

<style scoped>
/* Hallmark · genre: desktop workspace · tone: quiet utility · anchor hue: inherited · structure: Workstation split */
/* Hallmark · critique: P4 H5 E5 S4 R5 V4 · contrast: pass (40–41) · slop/mobile: pass */
.cowork-panel {
    --cowork-canvas: oklch(98% 0.006 255);
    --cowork-sidebar: oklch(95.5% 0.012 255);
    --cowork-surface: oklch(100% 0 0 / 0.86);
    --cowork-surface-muted: oklch(96.5% 0.008 255);
    --cowork-border: oklch(84% 0.018 255);
    --cowork-ink: oklch(32% 0.03 255);
    --cowork-muted: oklch(52% 0.025 255);
    --cowork-danger: oklch(48% 0.19 25);
    --cowork-success: oklch(55% 0.14 155);
    --cowork-accent: var(--color-primary);
    --cowork-accent-ink: oklch(100% 0 0);
    --cowork-accent-soft: var(--color-primary-alpha-10);
    --cowork-focus: var(--color-primary-alpha-30);
    --cowork-overlay-shadow: oklch(32% 0.03 255 / 0.16);
    --cowork-radius: 10px;
    --cowork-space: 16px;

    display: grid;
    grid-template-columns: minmax(176px, 220px) minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: clip;
    background: var(--cowork-canvas);
    color: var(--cowork-ink);
}

.cowork-sidebar {
    display: flex;
    min-height: 0;
    padding: var(--cowork-space) 12px;
    border-inline-end: 1px solid var(--cowork-border);
    overflow-y: auto;
    background: var(--cowork-sidebar);
    flex-direction: column;
    gap: 18px;
}

.workspace-heading,
.task-card-heading,
.result-card header,
.form-actions,
.card-actions,
.content-header,
.section-heading,
.form-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.workspace-heading {
    justify-content: flex-start;
}

.workspace-heading div {
    display: grid;
}

.workspace-heading small,
.overview-action small {
    color: var(--cowork-muted);
}

.workspace-mark {
    display: grid;
    inline-size: 34px;
    block-size: 34px;
    border-radius: 9px;
    background: var(--cowork-accent);
    color: var(--cowork-surface);
    font-weight: 800;
    place-items: center;
}

.cowork-sidebar nav {
    display: grid;
    gap: 4px;
}

.nav-item {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    inline-size: 100%;
    min-height: 42px;
    border-color: transparent;
    background: transparent;
    text-align: start;
}

.nav-item:hover {
    background: var(--cowork-surface);
}

.nav-item.active {
    border-color: var(--cowork-border);
    background: var(--cowork-surface);
    color: var(--cowork-accent);
    font-weight: 700;
}

.nav-count {
    min-inline-size: 22px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--cowork-surface-muted);
    color: var(--cowork-muted);
    font-size: 0.75rem;
    text-align: center;
}

.sidebar-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-block-start: auto;
    color: var(--cowork-muted);
    font-size: 0.75rem;
}

.status-dot,
.activity-status {
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--cowork-border);
    flex: none;
}

.status-dot.active,
.activity-status[data-status="success"] {
    background: var(--cowork-success);
}

.activity-status[data-status="failed"] {
    background: var(--cowork-danger);
}

.activity-status[data-status="running"] {
    background: var(--cowork-accent);
}

.cowork-content {
    min-inline-size: 0;
    min-height: 0;
    padding: clamp(18px, 4cqi, 36px);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
}

h2,
h3,
h4,
p {
    margin: 0;
}

.content-header {
    align-items: flex-start;
    margin-block-end: 28px;
}

.content-header h2 {
    margin-block-start: 3px;
    font-size: clamp(1.35rem, 4vw, 1.8rem);
    letter-spacing: -0.025em;
    overflow-wrap: anywhere;
}

.content-header > div > p:last-child,
.task-card p,
.result-meta {
    margin-block-start: 4px;
    color: var(--cowork-muted);
    font-size: 0.8125rem;
}

.section-context {
    color: var(--cowork-accent);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
}

button,
input,
textarea {
    font: inherit;
}

button {
    min-height: 36px;
    padding: 6px 10px;
    border: 1px solid var(--cowork-border);
    border-radius: 8px;
    background: var(--cowork-surface);
    color: var(--cowork-ink);
    cursor: pointer;
    transition: background-color 140ms ease, border-color 140ms ease;
    white-space: nowrap;
}

button:hover:not(:disabled) {
    border-color: var(--cowork-accent);
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible {
    outline: 3px solid var(--cowork-focus);
    outline-offset: 2px;
}

.primary-button {
    border-color: var(--cowork-accent);
    background: var(--cowork-accent);
    color: var(--cowork-accent-ink);
}

.new-task-button {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    align-self: stretch;
    justify-content: center;
    gap: 8px;
}

.danger-button {
    color: var(--cowork-danger);
}

.overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 420px);
}

.overview-action {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    min-height: 76px;
    padding: 14px;
    text-align: start;
}

.overview-action > span:nth-child(2) {
    display: grid;
    gap: 3px;
}

.overview-icon {
    display: grid;
    inline-size: 38px;
    block-size: 38px;
    border-radius: 9px;
    background: var(--cowork-accent-soft);
    color: var(--cowork-accent);
    place-items: center;
}

.activity-section {
    margin-block-start: 34px;
}

.section-heading {
    min-height: 36px;
    padding-block-end: 7px;
    border-block-end: 1px solid var(--cowork-border);
}

.section-heading > span {
    color: var(--cowork-muted);
    font-size: 0.75rem;
}

.text-button,
.icon-button {
    border-color: transparent;
    background: transparent;
    color: var(--cowork-accent);
}

.activity-row {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding-block: 13px;
    border-block-end: 1px solid var(--cowork-border);
}

.activity-row p {
    display: -webkit-box;
    margin-block-start: 3px;
    overflow: hidden;
    color: var(--cowork-muted);
    font-size: 0.8125rem;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.activity-row time {
    color: var(--cowork-muted);
    font-size: 0.75rem;
}

.activity-status {
    margin-block-start: 6px;
}

.task-form,
.task-card,
.result-card {
    margin-block-start: 12px;
    padding: 14px;
    border: 1px solid var(--cowork-border);
    border-radius: var(--cowork-radius);
    background: var(--cowork-surface);
}

.task-form {
    display: grid;
    gap: 16px;
}

.form-heading {
    align-items: flex-start;
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}

.field {
    display: grid;
    align-content: start;
    gap: 5px;
}

.full-field {
    grid-column: 1 / -1;
}

.task-form input:not([type="radio"], [type="checkbox"]),
.task-form input[type="number"],
.task-form input[type="time"],
.task-form textarea {
    width: 100%;
    min-height: 44px;
    padding: 10px;
    box-sizing: border-box;
    border: 1px solid var(--cowork-border);
    border-radius: 8px;
    background: var(--cowork-surface);
    color: var(--cowork-ink);
}

.task-form textarea {
    resize: vertical;
}

fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0;
    padding: 10px;
    border: 1px solid var(--cowork-border);
    border-radius: 8px;
}

.enabled-field {
    display: flex;
    align-items: center;
    gap: 8px;
}

.task-section,
.result-section {
    margin-block-start: 28px;
}

.status-label {
    padding: 3px 7px;
    border-radius: 999px;
    background: var(--cowork-surface-muted);
    color: var(--cowork-muted);
    font-size: 0.75rem;
    font-weight: 700;
}

.status-label.enabled {
    background: var(--cowork-accent-soft);
    color: var(--cowork-accent);
}

.task-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-block-start: 10px;
    color: var(--cowork-muted);
    font-size: 0.75rem;
}

.card-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
    margin-block-start: 10px;
}

.result-text {
    margin-block-start: 10px;
    white-space: pre-wrap;
    line-height: 1.6;
}

.notice,
.live-message,
.empty-message {
    margin-block-start: 12px;
}

.notice,
.empty-message {
    color: var(--cowork-muted);
}

.live-message {
    color: var(--cowork-danger);
}

.live-message:empty {
    display: none;
}

.run-status {
    color: var(--cowork-muted);
    font-size: 0.75rem;
    font-weight: 700;
}

.run-status[data-status="success"] {
    color: var(--cowork-success);
}

.run-status[data-status="failed"] {
    color: var(--cowork-danger);
}

.run-status[data-status="running"] {
    color: var(--cowork-accent);
}

@container chat-panel (max-width: 900px) {
    .cowork-panel {
        position: relative;
        grid-template-columns: 52px minmax(0, 1fr);
    }

    .cowork-sidebar {
        position: absolute;
        z-index: 2;
        inset-block: 0;
        inset-inline-start: 0;
        inline-size: 52px;
        box-sizing: border-box;
        padding: 14px 8px;
        overflow: clip;
        box-shadow: none;
        transition: inline-size 160ms ease, box-shadow 160ms ease;
    }

    .workspace-heading {
        justify-content: center;
    }

    .workspace-copy,
    .sidebar-label,
    .nav-count,
    .sidebar-status {
        display: none;
    }

    .cowork-sidebar nav {
        display: grid;
        overflow: visible;
    }

    .nav-item {
        display: grid;
        grid-template-columns: 22px;
        inline-size: 36px;
        min-width: 36px;
        padding-inline: 6px;
        place-items: center;
    }

    .new-task-button {
        inline-size: 36px;
        padding-inline: 6px;
    }

    .cowork-sidebar:is(:hover, :focus-within) {
        inline-size: min(220px, calc(100% - 12px));
        padding-inline: 12px;
        box-shadow: 10px 0 24px var(--cowork-overlay-shadow);
    }

    .cowork-sidebar:is(:hover, :focus-within) .workspace-heading {
        justify-content: flex-start;
    }

    .cowork-sidebar:is(:hover, :focus-within) .workspace-copy,
    .cowork-sidebar:is(:hover, :focus-within) .sidebar-label,
    .cowork-sidebar:is(:hover, :focus-within) .nav-count,
    .cowork-sidebar:is(:hover, :focus-within) .sidebar-status {
        display: initial;
    }

    .cowork-sidebar:is(:hover, :focus-within) .workspace-copy {
        display: grid;
    }

    .cowork-sidebar:is(:hover, :focus-within) .sidebar-status {
        display: flex;
    }

    .cowork-sidebar:is(:hover, :focus-within) .new-task-button {
        inline-size: 100%;
        padding-inline: 10px;
    }

    .cowork-sidebar:is(:hover, :focus-within) .nav-item {
        grid-template-columns: 22px minmax(0, 1fr) auto;
        inline-size: 100%;
        padding-inline: 10px;
        place-items: initial;
    }

    .cowork-content {
        grid-column: 2;
        padding: 18px;
    }
}

@container chat-panel (max-width: 520px) {
    .content-header,
    .task-card-heading,
    .result-card header {
        align-items: stretch;
        flex-direction: column;
    }

    .form-grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .header-action {
        inline-size: 100%;
    }

    .activity-row {
        grid-template-columns: 10px minmax(0, 1fr);
    }

    .activity-row time {
        grid-column: 2;
    }
}

@media (pointer: coarse) {
    button {
        min-height: 48px;
    }
}

@media (prefers-reduced-motion: reduce) {
    button {
        transition: none;
    }
}
</style>
