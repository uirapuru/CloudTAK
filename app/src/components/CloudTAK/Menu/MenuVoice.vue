<template>
    <MenuTemplate
        name='Głos'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                v-if='enabled && items.length'
                :title='selecting ? "Zakończ zaznaczanie" : "Zaznacz nagrania do usunięcia"'
                @click='toggleSelecting'
            >
                <IconListCheck
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
            <TablerIconButton
                v-if='enabled'
                title='Pobierz cały raport (nagrania i transkrypcje)'
                @click='downloadReport'
            >
                <IconFileZip
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
            <TablerIconButton
                v-if='enabled'
                title='Odśwież'
                @click='refresh'
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
                v-else-if='!enabled'
                label='Rejestr głosu nie jest włączony w tym środowisku'
                :create='false'
            />
            <template v-else>
                <div
                    v-if='speaking.length'
                    class='px-2 pt-2 small'
                >
                    <span
                        v-for='s in speaking'
                        :key='s.channel'
                        class='d-flex align-items-center gap-2'
                    >
                        <IconMicrophone
                            :size='16'
                            stroke='1'
                            class='text-red'
                        />
                        <span>Teraz mówi <strong v-text='s.user' /> na kanale <span v-text='s.channel' /></span>
                    </span>
                </div>

                <div class='row g-2 px-2 pt-2'>
                    <div class='col-12'>
                        <TablerEnum
                            v-model='channel'
                            label='Kanał'
                            :options='channelOptions'
                        />
                    </div>
                    <div class='col-6'>
                        <TablerInput
                            v-model='from'
                            label='Od'
                            type='datetime-local'
                        />
                    </div>
                    <div class='col-6'>
                        <TablerInput
                            v-model='to'
                            label='Do'
                            type='datetime-local'
                        />
                    </div>
                    <div class='col-12 d-flex justify-content-end'>
                        <button
                            class='btn btn-sm'
                            :disabled='!items.length'
                            @click='downloadRange'
                        >
                            <IconDownload
                                :size='16'
                                stroke='1'
                                class='me-1'
                            />
                            Pobierz zakres (ZIP)
                        </button>
                    </div>
                </div>

                <div
                    v-if='selecting'
                    class='d-flex align-items-center gap-2 px-2 pt-2'
                >
                    <span
                        class='small flex-grow-1'
                        v-text='`Zaznaczone: ${selected.size}`'
                    />
                    <button
                        class='btn btn-sm'
                        @click='selectAllVisible'
                    >
                        Zaznacz widoczne
                    </button>
                    <button
                        class='btn btn-sm btn-danger'
                        :disabled='!selected.size'
                        @click='askDelete([...selected])'
                    >
                        <IconTrash
                            :size='16'
                            stroke='1'
                            class='me-1'
                        />
                        Usuń zaznaczone
                    </button>
                </div>

                <TablerNone
                    v-if='!items.length'
                    label='Brak nagrań w tym zakresie'
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
                    >
                        <div class='d-flex align-items-center gap-2'>
                            <input
                                v-if='selecting'
                                type='checkbox'
                                class='form-check-input flex-shrink-0 m-0'
                                :checked='selected.has(rec.id)'
                                :aria-label='`Zaznacz nagranie ${rec.author} z ${when(rec.started_ts)}`'
                                @change='toggleSelected(rec.id)'
                            >
                            <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                                <div class='d-flex align-items-center gap-2'>
                                    <span
                                        class='fw-semibold text-truncate'
                                        v-text='rec.author'
                                    />
                                    <TablerBadge
                                        class='small flex-shrink-0'
                                        background-color='rgba(107, 114, 128, 0.15)'
                                        border-color='rgba(107, 114, 128, 0.3)'
                                        text-color='#6b7280'
                                    >
                                        {{ rec.channel }}
                                    </TablerBadge>
                                </div>
                                <span class='text-muted small'>
                                    {{ when(rec.started_ts) }} · {{ seconds(rec.duration_s) }}
                                </span>
                            </div>
                            <TablerIconButton
                                :title='playing === rec.id ? "Ukryj odtwarzacz" : "Odsłuchaj"'
                                @click='playing = playing === rec.id ? null : rec.id'
                            >
                                <IconPlayerPlay
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerIconButton
                                title='Zapisz nagranie'
                                @click='downloadOne(rec)'
                            >
                                <IconDownload
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerIconButton
                                v-if='!selecting'
                                title='Usuń nagranie'
                                @click='askDelete([rec.id])'
                            >
                                <IconTrash
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                        </div>
                        <audio
                            v-if='playing === rec.id'
                            class='w-100'
                            controls
                            autoplay
                            preload='none'
                            :src='audioSrc(rec)'
                        />
                        <div
                            v-if='rec.transcript_status === "done" && rec.transcript'
                            class='small voice-transcript'
                            v-text='rec.transcript'
                        />
                        <div
                            v-else
                            class='small text-muted fst-italic'
                            v-text='transcriptState(rec)'
                        />
                    </StandardItem>

                    <div
                        v-if='more'
                        class='d-flex justify-content-center'
                    >
                        <button
                            class='btn btn-sm'
                            :disabled='loadingMore'
                            @click='loadOlder'
                        >
                            Starsze nagrania
                        </button>
                    </div>
                </div>
            </template>

            <TablerModal v-if='confirmIds'>
                <button
                    type='button'
                    class='btn-close'
                    aria-label='Anuluj'
                    @click='confirmIds = null'
                />
                <div class='modal-status bg-red' />
                <div class='modal-header'>
                    Usuwanie nagrań
                </div>
                <div class='modal-body'>
                    <div v-text='deleteQuestion(confirmIds.length)' />
                    <div class='text-muted small mt-2'>
                        Nagranie i jego transkrypcja znikną z serwera. Tego nie da się cofnąć.
                    </div>
                </div>
                <div class='modal-footer'>
                    <button
                        class='btn'
                        :disabled='deleting'
                        @click='confirmIds = null'
                    >
                        Anuluj
                    </button>
                    <button
                        class='btn btn-danger'
                        :disabled='deleting'
                        @click='doDelete'
                    >
                        <IconTrash
                            :size='16'
                            stroke='1'
                            class='me-1'
                        />
                        Usuń
                    </button>
                </div>
            </TablerModal>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
    IconDownload,
    IconFileZip,
    IconListCheck,
    IconTrash,
    IconMicrophone,
    IconPlayerPlay,
    IconRefresh,
} from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerBadge,
    TablerEnum,
    TablerIconButton,
    TablerInput,
    TablerModal,
    TablerNone,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import { std, stdurl, downloadUrl, getRuntimeToken } from '../../../std.ts';
import {
    ALL_CHANNELS,
    type VoiceRecording,
    type VoiceStatus,
    rangeQuery,
    mergeNewest,
    transcriptState,
    speakingNow,
    deleteQuestion,
    withoutIds,
} from './voice.ts';

const PAGE = 50;
const REFRESH_MS = 10_000;

const loading = ref(true);
const loadingMore = ref(false);
const error = ref<Error | undefined>();
const enabled = ref(false);
const status = ref<VoiceStatus>({ enabled: false });
const items = ref<VoiceRecording[]>([]);
const more = ref(false);
const playing = ref<number | null>(null);
const token = ref<string | undefined>();

const selecting = ref(false);
const selected = ref(new Set<number>());
const confirmIds = ref<number[] | null>(null);
const deleting = ref(false);

const channel = ref(ALL_CHANNELS);
const from = ref('');
const to = ref('');

let timer: ReturnType<typeof setInterval> | undefined;

const channelOptions = computed(() => {
    const names = new Set<string>((status.value.channels || []).map((c) => c.name));
    for (const rec of items.value) names.add(rec.channel);
    return [ALL_CHANNELS, ...[...names].sort()];
});

const speaking = computed(() => speakingNow(status.value));

const range = computed(() => rangeQuery(channel.value, from.value, to.value));

onMounted(async () => {
    token.value = await getRuntimeToken();
    await refresh();
    loading.value = false;
    timer = setInterval(() => { refresh(true).catch(() => undefined); }, REFRESH_MS);
});

onUnmounted(() => {
    if (timer) clearInterval(timer);
});

watch(range, async () => {
    items.value = [];
    await refresh();
});

async function refresh(background = false): Promise<void> {
    try {
        status.value = await std('/api/voice/status') as VoiceStatus;
        enabled.value = status.value.enabled;
        if (!enabled.value) return;

        const url = stdurl('/api/voice/recordings');
        for (const [k, v] of Object.entries(range.value)) url.searchParams.set(k, String(v));
        url.searchParams.set('limit', String(PAGE));
        const page = (await std(url) as { items: VoiceRecording[] }).items;

        if (!items.value.length) more.value = page.length === PAGE;
        items.value = mergeNewest(items.value, page);
        error.value = undefined;
    } catch (err) {
        if (!background) error.value = err instanceof Error ? err : new Error(String(err));
    }
}

async function loadOlder(): Promise<void> {
    const last = items.value.at(-1);
    if (!last) return;
    loadingMore.value = true;
    try {
        const url = stdurl('/api/voice/recordings');
        for (const [k, v] of Object.entries(range.value)) url.searchParams.set(k, String(v));
        url.searchParams.set('limit', String(PAGE));
        url.searchParams.set('before_id', String(last.id));
        const page = (await std(url) as { items: VoiceRecording[] }).items;
        more.value = page.length === PAGE;
        items.value = [...items.value, ...page];
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loadingMore.value = false;
    }
}

function toggleSelecting(): void {
    selecting.value = !selecting.value;
    selected.value = new Set();
}

function toggleSelected(id: number): void {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
}

function selectAllVisible(): void {
    selected.value = new Set(items.value.map((r) => r.id));
}

function askDelete(ids: number[]): void {
    if (ids.length) confirmIds.value = ids;
}

async function doDelete(): Promise<void> {
    if (!confirmIds.value) return;
    const ids = confirmIds.value;
    deleting.value = true;
    try {
        const url = stdurl('/api/voice/recordings');
        url.searchParams.set('ids', ids.join(','));
        await std(url, { method: 'DELETE' });
        items.value = withoutIds(items.value, ids);
        if (playing.value !== null && ids.includes(playing.value)) playing.value = null;
        selected.value = new Set([...selected.value].filter((id) => !ids.includes(id)));
        if (!selected.value.size) selecting.value = false;
        confirmIds.value = null;
    } catch (err) {
        confirmIds.value = null;
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        deleting.value = false;
    }
}

function audioSrc(rec: VoiceRecording): string {
    const url = stdurl(`/api/voice/recordings/${rec.id}/audio`);
    if (token.value) url.searchParams.set('token', token.value);
    return url.toString();
}

async function downloadOne(rec: VoiceRecording): Promise<void> {
    await downloadUrl(`/api/voice/recordings/${rec.id}/audio?download=true`, { token: true });
}

async function downloadRange(): Promise<void> {
    const url = stdurl('/api/voice/export');
    for (const [k, v] of Object.entries(range.value)) url.searchParams.set(k, String(v));
    await downloadUrl(url, { token: true });
}

async function downloadReport(): Promise<void> {
    await downloadUrl('/api/voice/export', { token: true });
}

function when(ts: number): string {
    const d = new Date(ts * 1000);
    const today = new Date().toDateString() === d.toDateString();
    return today
        ? d.toLocaleTimeString('pl-PL')
        : d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'medium' });
}

function seconds(s: number): string {
    return `${s.toFixed(1).replace('.', ',')} s`;
}
</script>

<style scoped>
.voice-transcript {
    white-space: pre-wrap;
}
</style>
