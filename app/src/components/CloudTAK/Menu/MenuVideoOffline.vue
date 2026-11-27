<template>
    <MenuTemplate
        :name='path'
        :back='true'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                v-if='!denied && enabled'
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
            <div class='col-12 px-2 pt-2'>
                <div
                    v-if='live'
                    class='alert alert-success mb-0'
                    data-testid='video-offline-live'
                >
                    <div v-text='t("panels.videos.offlineView.liveAgain", { name: path })' />
                    <button
                        type='button'
                        class='btn btn-sm btn-success mt-2'
                        @click='router.push("/menu/videos")'
                        v-text='t("panels.videos.offlineView.backToList")'
                    />
                </div>
                <div
                    v-else
                    class='alert alert-warning mb-0'
                    data-testid='video-offline-info'
                >
                    <div
                        class='fw-bold'
                        v-text='t("panels.videos.offlineView.title", { name: path })'
                    />
                    <div
                        class='small'
                        v-text='t("panels.videos.offlineView.hint")'
                    />
                </div>
            </div>

            <div
                class='subheader px-2 pt-3'
                v-text='t("panels.videos.offlineView.recordings")'
            />

            <TablerNone
                v-if='denied'
                :label='t("panels.videos.offlineView.adminOnly")'
                :create='false'
            />
            <TablerAlert
                v-else-if='error'
                :err='error'
            />
            <TablerNone
                v-else-if='!enabled'
                :label='t("taklab.recordings.disabled")'
                :create='false'
            />
            <TablerNone
                v-else-if='!loading && !items.length'
                :label='t("panels.videos.offlineView.none")'
                :create='false'
            />
            <div
                v-else
                class='d-flex flex-column gap-2 py-2'
                data-testid='video-offline-recordings'
            >
                <StandardItem
                    v-for='rec in items'
                    :key='rec.id'
                    class='d-flex flex-column px-3 py-2 gap-1'
                >
                    <div class='d-flex align-items-center gap-2'>
                        <IconVideo
                            :size='24'
                            stroke='1'
                            class='flex-shrink-0'
                        />
                        <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                            <span
                                class='fw-semibold text-truncate'
                                v-text='displayName(rec, t("taklab.recordings.kind.video"))'
                            />
                            <span class='text-muted small'>
                                {{ when(rec.started_at) }}<template v-if='rec.duration_s !== null'> · {{ formatDuration(rec.duration_s) }}</template><template v-if='rec.size_bytes !== null'> · {{ formatSize(rec.size_bytes, locale) }}</template>
                            </span>
                        </div>
                        <TablerIconButton
                            :title='open === rec.id ? t("taklab.recordings.hidePreview") : t("taklab.recordings.preview.video")'
                            @click='open = open === rec.id ? null : rec.id'
                        >
                            <IconPlayerPlay
                                :size='20'
                                stroke='1'
                            />
                        </TablerIconButton>
                        <TablerIconButton
                            v-if='canAnalyse && rec.kind === "video"'
                            :title='t("videoAnalysis.analyseRecording")'
                            :disabled='analysing === rec.id'
                            @click='analyse(rec)'
                        >
                            <IconFaceId
                                :size='20'
                                stroke='1'
                            />
                        </TablerIconButton>
                        <TablerIconButton
                            :title='t("taklab.recordings.download")'
                            @click='download(rec)'
                        >
                            <IconDownload
                                :size='20'
                                stroke='1'
                            />
                        </TablerIconButton>
                    </div>
                    <video
                        v-if='open === rec.id'
                        class='w-100 rounded'
                        controls
                        autoplay
                        playsinline
                        preload='metadata'
                        :src='fileSrc(rec)'
                    />
                </StandardItem>

                <button
                    v-if='more'
                    type='button'
                    class='btn btn-sm btn-outline-secondary mx-2'
                    :disabled='loadingMore'
                    @click='loadMore'
                    v-text='t("taklab.recordings.more")'
                />
                <button
                    type='button'
                    class='btn btn-sm btn-link mx-2'
                    @click='router.push({ path: "/menu/recordings", query: { account: path } })'
                    v-text='t("panels.videos.offlineView.openRecordings")'
                />
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
/**
 * taklab: a stream from the Videos list that is not being published now.
 * Instead of the player's error the menu says so and lists the recordings
 * OTS kept from that path (the recording's account is the stream path).
 * Recordings are for the OTS administrator only (decision 24 XI 2026);
 * other accounts see the notice and a line saying who can see them.
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { IconDownload, IconFaceId, IconPlayerPlay, IconRefresh, IconVideo } from '@tabler/icons-vue';
import { TablerAlert, TablerIconButton, TablerNone } from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import { std, stdurl, downloadUrl, getRuntimeToken } from '../../../std.ts';
import { useLiveVideoStore } from '../../../stores/live-video.ts';
import { startAnalysis, videoAnalysisEnabled } from '../../../base/video-analysis.ts';
import { displayName, formatDuration, formatSize, type Recording, type RecordingList } from './recordings.ts';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const liveVideo = useLiveVideoStore();

const path = computed(() => String(route.params.path || ''));
const live = computed(() => liveVideo.stream(path.value) !== null);

const loading = ref(true);
const loadingMore = ref(false);
const enabled = ref(true);
const denied = ref(false);
const error = ref<Error | undefined>();
const items = ref<Recording[]>([]);
const page = ref(1);
const more = ref(false);
const open = ref<string | null>(null);
const token = ref<string | undefined>();

onMounted(async () => {
    token.value = await getRuntimeToken();
    await reload();
    loading.value = false;
});

function isForbidden(err: unknown): boolean {
    const body = (err as { body?: { status?: unknown } } | null)?.body;
    return Boolean(body && typeof body === 'object' && body.status === 403);
}

async function fetchPage(n: number): Promise<RecordingList> {
    const url = stdurl('/api/recordings');
    url.searchParams.set('kind', 'video');
    url.searchParams.set('account', path.value);
    if (n > 1) url.searchParams.set('page', String(n));
    return await std(url) as RecordingList;
}

/** OTS filters by account; the exact match keeps out accounts that only contain the path. */
function ofThisStream(list: Recording[]): Recording[] {
    const want = path.value.toLowerCase();
    return list.filter((r) => r.kind === 'video' && r.account.toLowerCase() === want);
}

async function reload(): Promise<void> {
    try {
        const list = await fetchPage(1);
        enabled.value = list.enabled;
        items.value = ofThisStream(list.items);
        page.value = 1;
        more.value = list.total_pages !== null ? list.total_pages > 1 : list.items.length > 0;
        error.value = undefined;
        denied.value = false;
    } catch (err) {
        if (isForbidden(err)) {
            denied.value = true;
        } else {
            error.value = err instanceof Error ? err : new Error(String(err));
        }
    }
}

async function loadMore(): Promise<void> {
    loadingMore.value = true;
    try {
        const list = await fetchPage(page.value + 1);
        const known = new Set(items.value.map((r) => r.id));
        const added = ofThisStream(list.items).filter((r) => !known.has(r.id));
        items.value = [...items.value, ...added];
        page.value += 1;
        // An OTS that ignores "page" would repeat the first page forever.
        more.value = list.total_pages !== null ? page.value < list.total_pages : added.length > 0;
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loadingMore.value = false;
    }
}

function fileSrc(rec: Recording): string {
    const url = stdurl(`/api/recordings/${encodeURIComponent(rec.id)}/file`);
    if (token.value) url.searchParams.set('token', token.value);
    return url.toString();
}

async function download(rec: Recording): Promise<void> {
    await downloadUrl(`/api/recordings/${encodeURIComponent(rec.id)}/file?download=true`, { token: true });
}

function when(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const tag = locale.value === 'pl' ? 'pl-PL' : 'en-GB';
    return d.toLocaleString(tag, { dateStyle: 'short', timeStyle: 'short' });
}

// taklab: start a video analysis of one recording and open it (OTS administrator with analysis on).
const canAnalyse = ref(false);
const analysing = ref<string | null>(null);
videoAnalysisEnabled().then((enabled) => { canAnalyse.value = enabled; });

async function analyse(rec: Recording): Promise<void> {
    analysing.value = rec.id;
    try {
        const a = await startAnalysis({ source: 'recording', recording_id: rec.id });
        await router.push(`/menu/video-analysis/${a.id}`);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        analysing.value = null;
    }
}
</script>
