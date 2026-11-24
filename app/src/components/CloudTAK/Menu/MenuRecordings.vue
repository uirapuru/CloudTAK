<template>
    <MenuTemplate
        :name='t("taklab.recordings.title")'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                v-if='trackShown'
                :title='t("taklab.recordings.hideTrack")'
                @click='hideTrack'
            >
                <IconEyeOff
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
            <TablerIconButton
                v-if='enabled'
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
            <TablerAlert
                v-if='error'
                :err='error'
            />
            <TablerNone
                v-if='!enabled && !error'
                :label='t("taklab.recordings.disabled")'
                :create='false'
            />
            <template v-else-if='enabled'>
                <div
                    v-if='usage && usage.admin'
                    class='px-2 pt-2'
                    data-testid='recordings-usage'
                >
                    <div class='d-flex justify-content-between small'>
                        <span v-text='t("taklab.recordings.usage")' />
                        <span v-text='usageText' />
                    </div>
                    <div
                        v-if='percent !== null'
                        class='progress progress-sm mt-1'
                    >
                        <div
                            class='progress-bar'
                            :class='percent >= 90 ? "bg-red" : (percent >= 70 ? "bg-yellow" : "bg-green")'
                            :style='{ width: `${percent}%` }'
                            role='progressbar'
                            :aria-valuenow='percent'
                            aria-valuemin='0'
                            aria-valuemax='100'
                        />
                    </div>
                </div>

                <div class='px-2 pt-2'>
                    <div
                        class='btn-group w-100'
                        role='group'
                        :aria-label='t("taklab.recordings.kindFilter")'
                    >
                        <button
                            v-for='k in KIND_FILTERS'
                            :key='k'
                            type='button'
                            class='btn btn-sm'
                            :class='{ active: kind === k }'
                            @click='kind = k'
                            v-text='t(`taklab.recordings.filter.${k}`)'
                        />
                    </div>
                </div>
                <div class='row g-2 px-2 pt-2'>
                    <div class='col-12'>
                        <TranslatedEnum
                            v-model='account'
                            :label='t("taklab.recordings.account")'
                            :options='accountOptions'
                        />
                    </div>
                    <div class='col-6'>
                        <TablerInput
                            v-model='from'
                            :label='t("taklab.recordings.from")'
                            type='datetime-local'
                        />
                    </div>
                    <div class='col-6'>
                        <TablerInput
                            v-model='to'
                            :label='t("taklab.recordings.to")'
                            type='datetime-local'
                        />
                    </div>
                </div>

                <div
                    v-if='items.length'
                    class='d-flex flex-column gap-2 px-3 pt-3'
                    data-testid='recordings-selection'
                >
                    <div class='d-flex align-items-center gap-2'>
                        <input
                            type='checkbox'
                            class='form-check-input m-0'
                            :checked='allShownSelected'
                            :indeterminate='selected.length > 0 && !allShownSelected'
                            :aria-label='t("taklab.recordings.selectAll")'
                            :title='t("taklab.recordings.selectAll")'
                            data-testid='recordings-select-all'
                            @change='toggleAll'
                        >
                        <span
                            class='small text-muted'
                            v-text='t("taklab.recordings.selected", { count: selected.length })'
                        />
                    </div>
                    <div class='d-flex flex-wrap gap-2'>
                        <button
                            type='button'
                            class='btn btn-sm'
                            :disabled='!selected.length || selected.length > MAX_ARCHIVE_IDS'
                            data-testid='recordings-download-selected'
                            @click='downloadArchive(selected)'
                        >
                            <IconFileZip
                                :size='16'
                                stroke='1'
                                class='me-1'
                            />
                            {{ t('taklab.recordings.downloadSelected') }}
                        </button>
                        <button
                            type='button'
                            class='btn btn-sm'
                            :title='t("taklab.recordings.downloadAllHint")'
                            data-testid='recordings-download-all'
                            @click='downloadArchive([])'
                        >
                            <IconFileZip
                                :size='16'
                                stroke='1'
                                class='me-1'
                            />
                            {{ t('taklab.recordings.downloadAll') }}
                        </button>
                    </div>
                    <div
                        v-if='selected.length > MAX_ARCHIVE_IDS'
                        class='small text-red'
                        v-text='t("taklab.recordings.tooMany", { max: MAX_ARCHIVE_IDS })'
                    />
                </div>

                <TablerNone
                    v-if='!items.length'
                    :label='t("taklab.recordings.none")'
                    :create='false'
                />
                <div
                    v-else
                    class='d-flex flex-column gap-2 py-2'
                >
                    <StandardItem
                        v-for='rec in items'
                        :key='rec.id'
                        class='d-flex flex-column px-3 py-2 gap-1'
                        :class='{ "recording-open": open === rec.id }'
                        :data-recording='rec.id'
                    >
                        <div class='d-flex align-items-center gap-2'>
                            <input
                                v-model='selected'
                                type='checkbox'
                                class='form-check-input m-0 flex-shrink-0'
                                :value='rec.id'
                                :aria-label='t("taklab.recordings.select")'
                                :title='t("taklab.recordings.select")'
                            >
                            <component
                                :is='KIND_ICONS[rec.kind]'
                                :size='24'
                                stroke='1'
                                class='flex-shrink-0'
                                :title='t(`taklab.recordings.kind.${rec.kind}`)'
                            />
                            <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                                <div
                                    v-if='renaming === rec.id'
                                    class='d-flex align-items-center gap-1'
                                >
                                    <input
                                        v-model='newName'
                                        class='form-control form-control-sm'
                                        maxlength='200'
                                        :aria-label='t("taklab.recordings.name")'
                                        @keyup.enter='saveName(rec)'
                                        @keyup.esc='renaming = null'
                                    >
                                    <TablerIconButton
                                        :title='t("taklab.recordings.saveName")'
                                        :disabled='!newName.trim() || busy'
                                        @click='saveName(rec)'
                                    >
                                        <IconCheck
                                            :size='20'
                                            stroke='1'
                                        />
                                    </TablerIconButton>
                                    <TablerIconButton
                                        :title='t("common.cancel")'
                                        @click='renaming = null'
                                    >
                                        <IconX
                                            :size='20'
                                            stroke='1'
                                        />
                                    </TablerIconButton>
                                </div>
                                <span
                                    v-else
                                    class='fw-semibold text-truncate'
                                    v-text='displayName(rec, t(`taklab.recordings.kind.${rec.kind}`))'
                                />
                                <span class='text-muted small text-truncate'>
                                    {{ rec.callsign || rec.account }}<template v-if='rec.callsign && rec.account && rec.callsign !== rec.account'> ({{ rec.account }})</template>
                                </span>
                                <span class='text-muted small'>
                                    {{ when(rec.started_at) }}<template v-if='rec.duration_s !== null'> · {{ formatDuration(rec.duration_s) }}</template><template v-if='rec.size_bytes !== null'> · {{ formatSize(rec.size_bytes, locale) }}</template>
                                </span>
                            </div>
                        </div>
                        <div class='d-flex align-items-center justify-content-end gap-1'>
                            <TablerIconButton
                                :title='open === rec.id ? t("taklab.recordings.hidePreview") : t(`taklab.recordings.preview.${rec.kind}`)'
                                @click='togglePreview(rec)'
                            >
                                <IconPlayerPlay
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerIconButton
                                :title='t("taklab.recordings.showOnMap")'
                                @click='showOnMap(rec)'
                            >
                                <IconMapPin
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
                            <TablerIconButton
                                v-if='rec.can_manage'
                                :title='t("taklab.recordings.rename")'
                                @click='startRename(rec)'
                            >
                                <IconPencil
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerIconButton
                                v-if='rec.can_manage'
                                :title='t("taklab.recordings.delete")'
                                @click='confirm = rec'
                            >
                                <IconTrash
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                        </div>

                        <template v-if='open === rec.id'>
                            <video
                                v-if='rec.kind === "video"'
                                class='w-100 rounded'
                                controls
                                playsinline
                                preload='metadata'
                                :src='fileSrc(rec)'
                            />
                            <audio
                                v-else-if='rec.kind === "voice"'
                                class='w-100'
                                controls
                                autoplay
                                preload='none'
                                :src='fileSrc(rec)'
                            />
                            <template v-else>
                                <img
                                    class='img-fluid rounded recording-scan'
                                    :src='fileSrc(rec)'
                                    :alt='t("taklab.recordings.scanAlt")'
                                >
                                <div
                                    v-if='details[rec.id]?.text'
                                    class='d-flex flex-column gap-1'
                                >
                                    <div
                                        class='small recording-text border rounded p-2'
                                        v-text='details[rec.id]?.text'
                                    />
                                    <div class='d-flex justify-content-end'>
                                        <button
                                            class='btn btn-sm'
                                            @click='copyText(details[rec.id]?.text ?? null)'
                                        >
                                            <IconCopy
                                                :size='16'
                                                stroke='1'
                                                class='me-1'
                                            />
                                            {{ copied ? t("taklab.recordings.copied") : t("taklab.common.copy") }}
                                        </button>
                                    </div>
                                </div>
                                <div
                                    v-else-if='details[rec.id]'
                                    class='small text-muted fst-italic'
                                    v-text='t("taklab.recordings.noText")'
                                />
                            </template>
                        </template>
                    </StandardItem>

                    <div
                        v-if='more'
                        class='d-flex justify-content-center'
                    >
                        <button
                            class='btn btn-sm'
                            :disabled='loadingMore'
                            @click='loadMore'
                        >
                            {{ t('taklab.recordings.more') }}
                        </button>
                    </div>
                </div>
            </template>

            <TablerModal v-if='confirm'>
                <button
                    type='button'
                    class='btn-close'
                    :aria-label='t("common.cancel")'
                    @click='confirm = null'
                />
                <div class='modal-status bg-red' />
                <div class='modal-header'>
                    {{ t('taklab.recordings.deleteTitle') }}
                </div>
                <div class='modal-body'>
                    <div v-text='t("taklab.recordings.deleteQuestion", { name: displayName(confirm, t(`taklab.recordings.kind.${confirm.kind}`)) })' />
                    <div class='text-muted small mt-2'>
                        {{ t('taklab.recordings.deleteWarning') }}
                    </div>
                </div>
                <div class='modal-footer'>
                    <button
                        class='btn'
                        :disabled='busy'
                        @click='confirm = null'
                    >
                        {{ t('common.cancel') }}
                    </button>
                    <button
                        class='btn btn-danger'
                        :disabled='busy'
                        @click='doDelete'
                    >
                        <IconTrash
                            :size='16'
                            stroke='1'
                            class='me-1'
                        />
                        {{ t('common.delete') }}
                    </button>
                </div>
            </TablerModal>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
    IconCheck,
    IconCopy,
    IconDownload,
    IconEyeOff,
    IconFileZip,
    IconMapPin,
    IconMicrophone,
    IconPencil,
    IconPlayerPlay,
    IconRefresh,
    IconScan,
    IconTrash,
    IconVideo,
    IconX,
} from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerIconButton,
    TablerInput,
    TablerModal,
    TablerNone,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import { std, stdurl, downloadUrl, getRuntimeToken } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import { recordingTrack } from '../../../base/recording-track.ts';
import {
    KIND_FILTERS,
    MAX_ARCHIVE_IDS,
    type KindFilter,
    type Recording,
    type RecordingDetail,
    type RecordingList,
    type RecordingUsage,
    archiveQuery,
    displayName,
    formatDuration,
    keepSelected,
    formatSize,
    listQuery,
    replaceRecording,
    startPosition,
    trackBounds,
    trackFeature,
    usagePercent,
    withoutRecording,
} from './recordings.ts';

const ALL_ACCOUNTS = '';
const REFRESH_MS = 15_000;

const KIND_ICONS = { video: IconVideo, voice: IconMicrophone, scan: IconScan };

const { t, locale } = useI18n();
const route = useRoute();
const mapStore = useMapStore();

const loading = ref(true);
const loadingMore = ref(false);
const busy = ref(false);
const error = ref<Error | undefined>();
const enabled = ref(true);
const usage = ref<RecordingUsage | null>(null);
const items = ref<Recording[]>([]);
const page = ref(1);
const more = ref(false);
const token = ref<string | undefined>();

const kind = ref<KindFilter>('all');
const account = ref(ALL_ACCOUNTS);
const from = ref('');
const to = ref('');
const seenAccounts = ref(new Set<string>());

const open = ref<string | null>(null);
const details = ref<Record<string, RecordingDetail>>({});
const renaming = ref<string | null>(null);
const newName = ref('');
const confirm = ref<Recording | null>(null);
const selected = ref<string[]>([]);
const copied = ref(false);
const trackShown = ref(recordingTrack.shown !== null);

let timer: ReturnType<typeof setInterval> | undefined;

const accountOptions = computed(() => [
    { value: ALL_ACCOUNTS, label: t('taklab.recordings.allAccounts') },
    ...[...seenAccounts.value].sort((a, b) => a.localeCompare(b)).map((a) => ({ value: a, label: a })),
]);

const percent = computed(() => usagePercent(usage.value));

const allShownSelected = computed(() => items.value.length > 0 && items.value.every((r) => selected.value.includes(r.id)));

const usageText = computed(() => {
    if (!usage.value || usage.value.used_bytes === null) return '';
    const used = formatSize(usage.value.used_bytes, locale.value);
    if (!usage.value.limit_bytes) return used;
    return t('taklab.recordings.usageOf', { used, limit: formatSize(usage.value.limit_bytes, locale.value) });
});

const filters = computed(() => listQuery(kind.value, account.value, from.value, to.value));

onMounted(async () => {
    token.value = await getRuntimeToken();
    await reload();
    loading.value = false;
    std('/api/recordings/usage').then((u) => { usage.value = u as RecordingUsage; }).catch(() => { usage.value = null; });

    const wanted = route.query.open;
    if (typeof wanted === 'string' && wanted) await openById(wanted);

    timer = setInterval(() => { refreshFirst().catch(() => undefined); }, REFRESH_MS);
});

onUnmounted(() => {
    if (timer) clearInterval(timer);
});

watch(filters, async () => {
    await reload();
});

watch(() => route.query.open, async (wanted) => {
    if (typeof wanted === 'string' && wanted) await openById(wanted);
});

function remember(list: Recording[]): void {
    const next = new Set(seenAccounts.value);
    for (const r of list) if (r.account) next.add(r.account);
    if (next.size !== seenAccounts.value.size) seenAccounts.value = next;
}

async function fetchPage(n: number): Promise<RecordingList> {
    const url = stdurl('/api/recordings');
    for (const [k, v] of Object.entries(listQuery(kind.value, account.value, from.value, to.value, n))) url.searchParams.set(k, v);
    return await std(url) as RecordingList;
}

async function reload(): Promise<void> {
    try {
        const list = await fetchPage(1);
        enabled.value = list.enabled;
        items.value = list.items;
        selected.value = keepSelected(selected.value, list.items);
        page.value = 1;
        more.value = list.total_pages !== null ? list.total_pages > 1 : list.items.length > 0;
        remember(list.items);
        error.value = undefined;
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

/** Background refresh: new recordings on top, known ones updated, older pages kept. */
async function refreshFirst(): Promise<void> {
    if (!enabled.value || renaming.value) return;
    const list = await fetchPage(1);
    const fresh = new Map(list.items.map((r) => [r.id, r]));
    const known = new Set(items.value.map((r) => r.id));
    items.value = [
        ...list.items.filter((r) => !known.has(r.id)),
        ...items.value.map((r) => fresh.get(r.id) ?? r),
    ];
    remember(list.items);
}

async function loadMore(): Promise<void> {
    loadingMore.value = true;
    try {
        const list = await fetchPage(page.value + 1);
        const known = new Set(items.value.map((r) => r.id));
        const added = list.items.filter((r) => !known.has(r.id));
        items.value = [...items.value, ...added];
        page.value += 1;
        // An OTS that ignores "page" would repeat the first page forever.
        more.value = list.total_pages !== null ? page.value < list.total_pages : added.length > 0;
        remember(added);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loadingMore.value = false;
    }
}

async function loadDetail(id: string): Promise<RecordingDetail> {
    const cached = details.value[id];
    if (cached) return cached;
    const rec = await std(`/api/recordings/${encodeURIComponent(id)}`) as RecordingDetail;
    details.value = { ...details.value, [id]: rec };
    return rec;
}

async function togglePreview(rec: Recording): Promise<void> {
    if (open.value === rec.id) {
        open.value = null;
        return;
    }
    open.value = rec.id;
    copied.value = false;
    if (rec.kind === 'scan') {
        try {
            await loadDetail(rec.id);
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        }
    }
}

/** Opened from a map marker ("Otwórz nagranie"): the recording may be outside the current page. */
async function openById(id: string): Promise<void> {
    try {
        const rec = await loadDetail(id);
        if (!items.value.some((r) => r.id === rec.id)) items.value = [rec, ...items.value];
        open.value = rec.id;
        setTimeout(() => {
            document.querySelector(`[data-recording="${CSS.escape(rec.id)}"]`)?.scrollIntoView({ block: 'nearest' });
        }, 0);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
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

function toggleAll(): void {
    selected.value = allShownSelected.value ? [] : items.value.map((r) => r.id);
}

/** ZIP built by OTS: the chosen recordings, or (empty list) all matching the filters. */
async function downloadArchive(ids: string[]): Promise<void> {
    const url = stdurl('/api/recordings/archive');
    for (const [k, v] of Object.entries(archiveQuery(ids, filters.value))) url.searchParams.set(k, v);
    try {
        await downloadUrl(url, { token: true });
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

function startRename(rec: Recording): void {
    renaming.value = rec.id;
    newName.value = rec.name || displayName(rec, t(`taklab.recordings.kind.${rec.kind}`));
}

async function saveName(rec: Recording): Promise<void> {
    if (!newName.value.trim()) return;
    busy.value = true;
    try {
        const updated = await std(`/api/recordings/${encodeURIComponent(rec.id)}`, {
            method: 'PATCH',
            body: { name: newName.value.trim() },
        }) as RecordingDetail;
        items.value = replaceRecording(items.value, updated);
        if (details.value[updated.id]) details.value = { ...details.value, [updated.id]: { ...details.value[updated.id], ...updated } };
        renaming.value = null;
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        busy.value = false;
    }
}

async function doDelete(): Promise<void> {
    const rec = confirm.value;
    if (!rec) return;
    busy.value = true;
    try {
        await std(`/api/recordings/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
        items.value = withoutRecording(items.value, rec.id);
        selected.value = selected.value.filter((id) => id !== rec.id);
        if (open.value === rec.id) open.value = null;
        if (recordingTrack.shown === rec.id) hideTrack();
        confirm.value = null;
    } catch (err) {
        confirm.value = null;
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        busy.value = false;
    }
}

async function showOnMap(rec: Recording): Promise<void> {
    try {
        const full = await loadDetail(rec.id);
        const start = startPosition(full);
        if (!start) throw new Error(t('taklab.recordings.noPosition'));
        const line = trackFeature(full);
        if (line) {
            recordingTrack.show(mapStore.map, line);
            trackShown.value = true;
            const box = trackBounds(line);
            mapStore.map.fitBounds(box, { padding: 80, maxZoom: 17 });
        } else {
            mapStore.map.flyTo({ center: start, zoom: Math.max(mapStore.map.getZoom(), 15) });
        }
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

function hideTrack(): void {
    recordingTrack.hide(mapStore.map);
    trackShown.value = false;
}

async function copyText(text: string | null): Promise<void> {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copied.value = true;
}

function when(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const today = new Date().toDateString() === d.toDateString();
    const tag = locale.value === 'pl' ? 'pl-PL' : 'en-GB';
    return today
        ? d.toLocaleTimeString(tag)
        : d.toLocaleString(tag, { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<style scoped>
.recording-text {
    white-space: pre-wrap;
    max-height: 16rem;
    overflow-y: auto;
}

.recording-scan {
    max-height: 40vh;
    object-fit: contain;
}

.recording-open {
    outline: 1px solid rgba(232, 89, 12, 0.6);
}
</style>
