<template>
    <MenuTemplate
        :name='title'
        :back='true'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                v-if='analysis && isActive(analysis)'
                :title='t("videoAnalysis.stop")'
                @click='stop'
            >
                <IconPlayerStop
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>
        <template #default>
            <TablerAlert
                v-if='error'
                :err='error'
            />
            <template v-if='analysis'>
                <div
                    v-if='notice'
                    class='alert mx-2 mt-2 mb-0'
                    :class='notice.level === "warning" ? "alert-warning" : "alert-info"'
                    role='status'
                    data-testid='video-analysis-notice'
                    v-text='notice.text'
                />
                <div class='px-3 pt-2 d-flex align-items-center gap-2'>
                    <span
                        class='badge'
                        :class='badgeClass'
                    >
                        {{ t(`videoAnalysis.state.${analysis.state}`) }}<template v-if='progressDetail(analysis)'> · {{ progressDetail(analysis) }}</template>
                    </span>
                    <span
                        class='text-muted small'
                        v-text='t("videoAnalysis.by", { name: analysis.created_by })'
                    />
                </div>
                <div
                    v-if='analysis.source === "recording" && analysis.state === "running" && analysis.percent !== null'
                    class='progress mx-3 mt-2'
                    style='height: 6px;'
                >
                    <div
                        class='progress-bar'
                        :style='{ width: `${Math.min(100, Math.max(0, analysis.percent))}%` }'
                    />
                </div>
                <div
                    v-if='analysis.state === "queued"'
                    class='px-3 pt-2 text-muted small'
                    v-text='t("videoAnalysis.queuedHint")'
                />
                <div
                    v-if='analysis.error'
                    class='alert alert-danger mx-2 mt-2 mb-0'
                    v-text='analysis.error'
                />
                <div class='px-2 pt-3 d-flex justify-content-end'>
                    <button
                        v-if='isActive(analysis)'
                        type='button'
                        class='btn btn-sm btn-outline-danger'
                        :disabled='stopping'
                        @click='stop'
                        v-text='t("videoAnalysis.stop")'
                    />
                </div>

                <div
                    class='subheader px-2 pt-2'
                    v-text='t("videoAnalysis.faces")'
                />
                <div
                    v-if='!faces.length'
                    class='px-3 py-2 text-muted small'
                    v-text='t("videoAnalysis.noFaces")'
                />
                <div
                    v-else
                    class='face-grid px-2 py-2'
                    data-testid='video-analysis-faces'
                >
                    <button
                        v-for='face in faces'
                        :key='face.id'
                        type='button'
                        class='face btn p-0 border-0 position-relative'
                        :class='{ "face-selected": selected?.id === face.id }'
                        :title='face.label'
                        @click='selected = selected?.id === face.id ? null : face'
                    >
                        <img
                            :src='thumbSrc(face, token)'
                            :alt='face.label'
                            class='w-100 rounded'
                        >
                        <span
                            class='face-count'
                            v-text='face.count'
                        />
                    </button>
                </div>

                <div
                    v-if='selected'
                    class='mx-2 mb-2 p-2 border rounded'
                    data-testid='video-analysis-face'
                >
                    <div class='d-flex gap-2'>
                        <img
                            :src='thumbSrc(selected, token)'
                            :alt='selected.label'
                            class='rounded flex-shrink-0'
                            style='width: 128px;'
                        >
                        <div class='overflow-hidden'>
                            <div
                                class='fw-semibold'
                                v-text='selected.label'
                            />
                            <div
                                class='small text-muted'
                                v-text='t("videoAnalysis.appearances")'
                            />
                            <div
                                v-for='m in selected.moments'
                                :key='m.sighting_id'
                                class='small'
                                v-text='m.moment'
                            />
                        </div>
                    </div>
                </div>
            </template>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
/** taklab: one on-demand video analysis: state, progress, stop and the grid of recognised faces. */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { IconPlayerStop } from '@tabler/icons-vue';
import { TablerAlert, TablerIconButton } from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import { getRuntimeToken } from '../../../std.ts';
import {
    POLL_MS,
    type Analysis,
    type AnalysisFace,
    type AnalysisNotice,
    getAnalysis,
    getFaces,
    isActive,
    progressDetail,
    stopAnalysis,
    thumbSrc,
} from '../../../base/video-analysis.ts';

const { t } = useI18n();
const route = useRoute();

const id = computed(() => Number(route.params.id));
const loading = ref(true);
const error = ref<Error | undefined>();
const analysis = ref<Analysis | null>(null);
const faces = ref<AnalysisFace[]>([]);
const selected = ref<AnalysisFace | null>(null);
const notice = ref<AnalysisNotice | null>(null);
const stopping = ref(false);
const token = ref<string | undefined>();

let timer: ReturnType<typeof setInterval> | undefined;
/** Bumped on every id change and unmount, so a late answer for another analysis is dropped. */
let run = 0;

const title = computed(() => {
    const a = analysis.value;
    if (!a) return t('videoAnalysis.title');
    return a.source === 'live'
        ? t('videoAnalysis.titleLive', { id: a.id, path: a.label })
        : t('videoAnalysis.titleRecording', { id: a.id, name: a.label });
});

const badgeClass = computed(() => {
    const state = analysis.value?.state;
    if (state === 'running') return 'bg-blue text-white';
    if (state === 'queued') return 'bg-yellow text-dark';
    if (state === 'error') return 'bg-red text-white';
    return 'bg-secondary text-white';
});

function stopPolling(): void {
    if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
    }
}

async function refresh(mine: number): Promise<void> {
    try {
        const [a, f] = await Promise.all([getAnalysis(id.value), getFaces(id.value)]);
        if (mine !== run) return;
        const { notice: n, ...rest } = a;
        analysis.value = rest;
        notice.value = n ?? null;
        faces.value = f;
        if (selected.value) selected.value = f.find((x) => x.id === selected.value?.id) ?? null;
        error.value = undefined;
        if (!isActive(a)) stopPolling();
    } catch (err) {
        if (mine !== run) return;
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

async function open(): Promise<void> {
    stopPolling();
    const mine = ++run;
    analysis.value = null;
    notice.value = null;
    faces.value = [];
    selected.value = null;
    if (!Number.isInteger(id.value) || id.value < 0) return;
    loading.value = true;
    await refresh(mine);
    if (mine === run) loading.value = false;
    if (mine === run && analysis.value && isActive(analysis.value)) {
        timer = setInterval(() => refresh(mine), POLL_MS);
    }
}

async function stop(): Promise<void> {
    if (!analysis.value) return;
    stopping.value = true;
    try {
        analysis.value = await stopAnalysis(analysis.value.id);
        if (!isActive(analysis.value)) {
            notice.value = null;
            stopPolling();
        }
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        stopping.value = false;
    }
}

onMounted(async () => {
    token.value = await getRuntimeToken();
    await open();
});

watch(id, open);

onUnmounted(() => {
    run++;
    stopPolling();
});
</script>

<style scoped>
.face-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
}

.face-selected img {
    outline: 2px solid var(--tblr-primary);
}

.face-count {
    position: absolute;
    right: 4px;
    bottom: 4px;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: #d63939;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    text-align: center;
}
</style>
