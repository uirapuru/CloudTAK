<template>
    <MenuTemplate
        :name='t("videoAnalysis.title")'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                v-if='!denied'
                :title='t("videoAnalysis.new")'
                @click='togglePicker'
            >
                <IconPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
            <TablerIconButton
                v-if='!denied'
                :title='t("taklab.common.refresh")'
                @click='reload'
            >
                <IconRefresh
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>
        <template #default>
            <TablerNone
                v-if='denied'
                :label='deniedText'
                :create='false'
            />
            <template v-else>
                <TablerAlert
                    v-if='error'
                    :err='error'
                />

                <div
                    v-if='picker'
                    class='border-bottom pb-2'
                    data-testid='video-analysis-picker'
                >
                    <div
                        class='subheader px-2 pt-2'
                        v-text='t("videoAnalysis.new")'
                    />
                    <TablerLoading v-if='sourcesLoading' />
                    <div
                        v-else-if='!live.length && !recordings.length'
                        class='px-3 py-2 text-muted small'
                        v-text='t("videoAnalysis.nothing")'
                    />
                    <template v-else>
                        <template v-if='live.length'>
                            <div
                                class='px-3 pt-2 fw-semibold small'
                                v-text='t("videoAnalysis.live")'
                            />
                            <label
                                v-for='s in live'
                                :key='"live:" + s.path'
                                class='form-check px-3 py-1 d-flex gap-2 align-items-start mb-0'
                                :class='{ "text-muted": s.analysis !== null }'
                            >
                                <input
                                    v-model='choice'
                                    class='form-check-input ms-0 mt-1 flex-shrink-0'
                                    type='radio'
                                    :value='"live:" + s.path'
                                    :disabled='s.analysis !== null'
                                >
                                <span class='small'>
                                    {{ [s.path, s.account, s.ready_time ? t("videoAnalysis.since", { time: clock(s.ready_time) }) : ''].filter(Boolean).join(' · ') }}<template v-if='s.analysis !== null'> · {{ t("videoAnalysis.busy") }}</template>
                                </span>
                            </label>
                        </template>
                        <template v-if='recordings.length'>
                            <div
                                class='px-3 pt-2 fw-semibold small'
                                v-text='t("videoAnalysis.recordings")'
                            />
                            <label
                                v-for='r in recordings'
                                :key='"rec:" + r.id'
                                class='form-check px-3 py-1 d-flex gap-2 align-items-start mb-0'
                            >
                                <input
                                    v-model='choice'
                                    class='form-check-input ms-0 mt-1 flex-shrink-0'
                                    type='radio'
                                    :value='"rec:" + r.id'
                                >
                                <span class='small'>
                                    {{ [r.name, r.account, when(r.started_at), r.duration_s !== null ? formatDuration(r.duration_s) : ''].filter(Boolean).join(' · ') }}
                                </span>
                            </label>
                        </template>
                    </template>
                    <div class='d-flex justify-content-end gap-2 px-3 pt-2'>
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-secondary'
                            @click='picker = false'
                            v-text='t("videoAnalysis.cancel")'
                        />
                        <button
                            type='button'
                            class='btn btn-sm btn-primary'
                            :disabled='!choice || starting'
                            @click='start'
                            v-text='t("videoAnalysis.analyse")'
                        />
                    </div>
                </div>

                <TablerNone
                    v-if='!loading && !analyses.length'
                    :label='t("videoAnalysis.none")'
                    :create='false'
                />
                <div
                    v-else
                    class='d-flex flex-column gap-1 py-2'
                    data-testid='video-analysis-list'
                >
                    <StandardItem
                        v-for='a in analyses'
                        :key='a.id'
                        class='d-flex align-items-center gap-2 px-3 py-2'
                        @click='router.push(`/menu/video-analysis/${a.id}`)'
                    >
                        <component
                            :is='a.source === "live" ? IconBroadcast : IconMovie'
                            :size='24'
                            stroke='1'
                            class='flex-shrink-0'
                        />
                        <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                            <span
                                class='fw-semibold text-truncate'
                                v-text='`#${a.id} · ${a.label}`'
                            />
                            <span class='text-muted small text-truncate'>
                                {{ when(a.created_at) }} · {{ t("videoAnalysis.by", { name: a.created_by }) }}
                            </span>
                        </div>
                        <div class='d-flex flex-column align-items-end flex-shrink-0'>
                            <span
                                class='badge'
                                :class='badgeClass(a)'
                            >
                                {{ t(`videoAnalysis.state.${a.state}`) }}<template v-if='progressDetail(a)'> · {{ progressDetail(a) }}</template>
                            </span>
                            <span
                                class='text-muted small'
                                v-text='t("videoAnalysis.persons", { count: a.persons })'
                            />
                        </div>
                    </StandardItem>
                </div>
            </template>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
/**
 * taklab: on-demand video analysis for the OTS administrator (the same
 * feature as "Analiza wideo" in the OTS panel): list of analyses, start a
 * new one on a live stream or a ready recording, open its faces.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { IconBroadcast, IconMovie, IconPlus, IconRefresh } from '@tabler/icons-vue';
import { TablerAlert, TablerIconButton, TablerLoading, TablerNone } from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import { formatDuration } from './recordings.ts';
import {
    POLL_MS,
    type Analysis,
    type AnalysisChoice,
    type LiveSource,
    type RecordingSource,
    getSources,
    isActive,
    listAnalyses,
    progressDetail,
    startAnalysis,
} from '../../../base/video-analysis.ts';

const { t, locale } = useI18n();
const router = useRouter();

const loading = ref(true);
const error = ref<Error | undefined>();
const denied = ref<number | null>(null);
const analyses = ref<Analysis[]>([]);

const picker = ref(false);
const sourcesLoading = ref(false);
const live = ref<LiveSource[]>([]);
const recordings = ref<RecordingSource[]>([]);
const choice = ref('');
const starting = ref(false);

let timer: ReturnType<typeof setInterval> | undefined;

const deniedText = computed(() => denied.value === 404
    ? t('videoAnalysis.disabled')
    : t('videoAnalysis.adminOnly'));

function status(err: unknown): number | null {
    const body = (err as { body?: { status?: unknown } } | null)?.body;
    return body && typeof body.status === 'number' ? body.status : null;
}

function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}

onMounted(async () => {
    await reload();
    loading.value = false;
});

onUnmounted(() => stopPolling());

function stopPolling(): void {
    if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
    }
}

async function reload(): Promise<void> {
    try {
        analyses.value = await listAnalyses();
        error.value = undefined;
    } catch (err) {
        const code = status(err);
        if (code === 403 || code === 404) denied.value = code;
        else error.value = asError(err);
    }
    // The list refreshes only while something is queued or running.
    if (analyses.value.some(isActive) && denied.value === null) {
        if (timer === undefined) timer = setInterval(reload, POLL_MS);
    } else {
        stopPolling();
    }
}

async function togglePicker(): Promise<void> {
    picker.value = !picker.value;
    if (!picker.value) return;
    choice.value = '';
    sourcesLoading.value = true;
    try {
        const s = await getSources();
        live.value = s.live;
        recordings.value = s.recordings;
    } catch (err) {
        error.value = asError(err);
        picker.value = false;
    } finally {
        sourcesLoading.value = false;
    }
}

async function start(): Promise<void> {
    let body: AnalysisChoice;
    if (choice.value.startsWith('live:')) body = { source: 'live', path: choice.value.slice(5) };
    else if (choice.value.startsWith('rec:')) body = { source: 'recording', recording_id: choice.value.slice(4) };
    else return;
    starting.value = true;
    try {
        const a = await startAnalysis(body);
        picker.value = false;
        await router.push(`/menu/video-analysis/${a.id}`);
    } catch (err) {
        error.value = asError(err);
    } finally {
        starting.value = false;
    }
}

function badgeClass(a: Analysis): string {
    if (a.state === 'running') return 'bg-blue text-white';
    if (a.state === 'queued') return 'bg-yellow text-dark';
    if (a.state === 'error') return 'bg-red text-white';
    return 'bg-secondary text-white';
}

function when(iso: string): string {
    // The vision service gives "2026-11-26 14:32:05" in Europe/Warsaw already; shown as is.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(iso)) return iso.slice(0, 16);
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const tag = locale.value === 'pl' ? 'pl-PL' : 'en-GB';
    return d.toLocaleString(tag, { dateStyle: 'short', timeStyle: 'short' });
}

function clock(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleTimeString(locale.value === 'pl' ? 'pl-PL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}
</script>
