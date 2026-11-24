<template>
    <MenuTemplate
        :name='t("taklab.journal.title")'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
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

            <div class='row g-2 px-2 pt-2'>
                <div class='col-6'>
                    <TablerInput
                        v-model='filters.since'
                        :label='t("taklab.journal.since")'
                        type='datetime-local'
                    />
                </div>
                <div class='col-6'>
                    <TablerInput
                        v-model='filters.until'
                        :label='t("taklab.journal.until")'
                        type='datetime-local'
                    />
                </div>
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='filters.account'
                        :label='t("taklab.journal.account")'
                        :options='accountOptions'
                    />
                </div>
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='filters.kind'
                        :label='t("taklab.journal.kind")'
                        :options='kindOptions'
                    />
                </div>
                <div class='col-12'>
                    <TablerInput
                        v-model='search'
                        :label='t("taklab.journal.search")'
                        :placeholder='t("taklab.journal.searchHint")'
                    />
                </div>
                <div class='col-12 small text-muted px-3'>
                    {{ t('taklab.journal.timezone') }}
                </div>
                <div class='col-12'>
                    <TablerToggle
                        v-model='filters.positions'
                        :label='t("taklab.journal.positions")'
                    />
                </div>
                <div class='col-12 d-flex gap-2'>
                    <button
                        class='btn btn-sm flex-grow-1'
                        :disabled='busy'
                        data-testid='journal-export-pdf'
                        @click='exportPdf'
                    >
                        <IconFileTypePdf
                            :size='16'
                            stroke='1'
                            class='me-1'
                        />
                        {{ t('taklab.journal.exportPdf') }}
                    </button>
                    <button
                        class='btn btn-sm flex-grow-1'
                        :disabled='busy'
                        data-testid='journal-export-zip'
                        @click='askZip'
                    >
                        <IconFileZip
                            :size='16'
                            stroke='1'
                            class='me-1'
                        />
                        {{ t('taklab.journal.exportZip') }}
                    </button>
                </div>
            </div>

            <TablerNone
                v-if='!items.length && !error'
                :label='t("taklab.journal.none")'
                :create='false'
            />
            <div
                v-else-if='items.length'
                class='d-flex flex-column gap-2 py-2'
            >
                <div class='px-3 small text-muted'>
                    {{ t('taklab.journal.count', { total }) }}
                </div>
                <StandardItem
                    v-for='entry in items'
                    :key='entry.id'
                    class='d-flex flex-column px-3 py-2 gap-1'
                    :class='{ "journal-private": entry.private }'
                    :data-entry='entry.id'
                >
                    <div class='d-flex align-items-start gap-2'>
                        <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                            <div class='d-flex align-items-center gap-2 small text-muted'>
                                <span
                                    class='journal-time'
                                    v-text='formatWhen(entry.at, locale)'
                                />
                                <span
                                    class='badge bg-blue-lt'
                                    v-text='kindLabel(entry.kind)'
                                />
                                <span
                                    v-if='entry.private'
                                    class='badge bg-red text-white'
                                    data-testid='journal-private'
                                    v-text='t("taklab.journal.private")'
                                />
                            </div>
                            <span
                                class='small'
                                v-text='whoLabel(entry.callsign, entry.account) ?? t("taklab.journal.server")'
                            />
                            <span
                                v-if='entry.title'
                                class='fw-semibold'
                                v-text='entry.title'
                            />
                            <span
                                v-if='entry.recipients.length'
                                class='small'
                                :class='{ "text-red fw-semibold": entry.private }'
                                v-text='t("taklab.journal.to", { who: recipientsLabel(entry.recipients) })'
                            />
                            <span
                                v-else-if='entry.chatroom'
                                class='small text-muted'
                                v-text='t("taklab.journal.room", { room: entry.chatroom })'
                            />
                            <div
                                v-if='entry.text'
                                class='journal-text small border rounded p-2 mt-1'
                                v-text='entry.text'
                            />
                            <div
                                v-if='entry.file'
                                class='small d-flex align-items-center gap-1 mt-1'
                            >
                                <IconPaperclip
                                    :size='16'
                                    stroke='1'
                                />
                                <span
                                    class='text-truncate'
                                    v-text='entry.file.filename || entry.file.ref'
                                />
                                <span
                                    v-if='entry.file.size !== null'
                                    class='text-muted'
                                    v-text='formatSize(entry.file.size, locale)'
                                />
                                <span
                                    v-if='!entry.file.available'
                                    class='badge bg-secondary-lt'
                                    v-text='t("taklab.journal.fileMissing")'
                                />
                            </div>
                            <span
                                v-if='entry.mission'
                                class='small text-muted'
                                v-text='t("taklab.journal.mission", { name: entry.mission })'
                            />
                        </div>
                        <TablerIconButton
                            v-if='entryPosition(entry)'
                            :title='t("taklab.journal.showOnMap")'
                            @click='showOnMap(entry)'
                        >
                            <IconMapPin
                                :size='20'
                                stroke='1'
                            />
                        </TablerIconButton>
                    </div>
                </StandardItem>

                <div
                    v-if='pages > 1'
                    class='d-flex justify-content-center align-items-center gap-2'
                >
                    <TablerIconButton
                        :title='t("taklab.journal.prev")'
                        :disabled='page <= 1 || loading'
                        @click='goTo(page - 1)'
                    >
                        <IconChevronLeft
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <span
                        class='small'
                        v-text='t("taklab.journal.page", { page, pages })'
                    />
                    <TablerIconButton
                        :title='t("taklab.journal.next")'
                        :disabled='page >= pages || loading'
                        @click='goTo(page + 1)'
                    >
                        <IconChevronRight
                            :size='20'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>

            <TablerModal v-if='zipEstimate'>
                <button
                    type='button'
                    class='btn-close'
                    :aria-label='t("common.cancel")'
                    @click='zipEstimate = null'
                />
                <div class='modal-status bg-blue' />
                <div class='modal-header'>
                    {{ t('taklab.journal.zipTitle') }}
                </div>
                <div
                    class='modal-body d-flex flex-column gap-1'
                    data-testid='journal-zip-estimate'
                >
                    <div v-text='t("taklab.journal.estimateEntries", { n: zipEstimate.entries })' />
                    <div v-text='t("taklab.journal.estimateFiles", { n: zipEstimate.files, size: formatSize(zipEstimate.bytes, locale) })' />
                    <div
                        v-if='zipEstimate.missing'
                        class='text-red'
                        v-text='t("taklab.journal.estimateMissing", { n: zipEstimate.missing })'
                    />
                </div>
                <div class='modal-footer'>
                    <button
                        class='btn'
                        @click='zipEstimate = null'
                    >
                        {{ t('common.cancel') }}
                    </button>
                    <button
                        class='btn btn-primary'
                        data-testid='journal-zip-confirm'
                        @click='downloadZip'
                    >
                        <IconDownload
                            :size='16'
                            stroke='1'
                            class='me-1'
                        />
                        {{ t('taklab.journal.zipConfirm') }}
                    </button>
                </div>
            </TablerModal>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
    IconChevronLeft,
    IconChevronRight,
    IconDownload,
    IconFileTypePdf,
    IconFileZip,
    IconMapPin,
    IconPaperclip,
    IconRefresh,
} from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerIconButton,
    TablerInput,
    TablerModal,
    TablerNone,
    TablerToggle,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import { std, stdurl, downloadUrl } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import { formatSize } from './recordings.ts';
import {
    JOURNAL_KINDS,
    PDF_MAX_ENTRIES,
    PER_PAGE,
    type JournalAccount,
    type JournalEntry,
    type JournalEstimate,
    type JournalList,
    accountLabel,
    defaultFilters,
    entryPosition,
    formatWhen,
    journalQuery,
    recipientsLabel,
    totalPages,
    whoLabel,
} from './journal.ts';

const SEARCH_DELAY_MS = 400;

const { t, te, locale } = useI18n();
const mapStore = useMapStore();

const loading = ref(true);
const busy = ref(false);
const error = ref<Error | undefined>();
const items = ref<JournalEntry[]>([]);
const total = ref(0);
const page = ref(1);
const accounts = ref<JournalAccount[]>([]);
const zipEstimate = ref<JournalEstimate | null>(null);

const filters = ref(defaultFilters());
const search = ref('');
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const pages = computed(() => totalPages(total.value, PER_PAGE));

const accountOptions = computed(() => [
    { value: '', label: t('taklab.journal.allAccounts') },
    ...accounts.value.map((a) => ({ value: a.account, label: accountLabel(a) })),
]);

const kindOptions = computed(() => [
    { value: '', label: t('taklab.journal.allKinds') },
    ...JOURNAL_KINDS.map((k) => ({ value: k, label: kindLabel(k) })),
]);

function kindLabel(kind: string): string {
    const key = `taklab.journal.kinds.${kind}`;
    return te(key) ? t(key) : kind;
}

onMounted(async () => {
    std('/api/journal/accounts').then((body) => {
        accounts.value = (body as { accounts: JournalAccount[] }).accounts;
    }).catch(() => {
        accounts.value = [];
    });
    await load(1);
    loading.value = false;
});

onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer);
});

watch(filters, async () => {
    await load(1);
}, { deep: true });

watch(search, (value) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        filters.value = { ...filters.value, q: value };
    }, SEARCH_DELAY_MS);
});

function url(path: string, query: Record<string, string>): URL {
    const u = stdurl(path);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
}

async function load(n: number): Promise<void> {
    loading.value = true;
    try {
        const list = await std(url('/api/journal', journalQuery(filters.value, n, PER_PAGE))) as JournalList;
        items.value = list.items;
        total.value = list.total;
        page.value = list.page || n;
        error.value = undefined;
    } catch (err) {
        items.value = [];
        total.value = 0;
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loading.value = false;
    }
}

async function reload(): Promise<void> {
    await load(page.value);
}

async function goTo(n: number): Promise<void> {
    if (n < 1 || n > pages.value) return;
    await load(n);
}

async function estimate(): Promise<JournalEstimate> {
    return await std(url('/api/journal/export/estimate', journalQuery(filters.value))) as JournalEstimate;
}

async function exportPdf(): Promise<void> {
    busy.value = true;
    try {
        // A plain download link would save the OTS 413 answer as a file; ask first.
        const est = await estimate();
        if (est.entries > PDF_MAX_ENTRIES) {
            throw new Error(t('taklab.journal.pdfTooBig', { n: est.entries, max: PDF_MAX_ENTRIES }));
        }
        await downloadUrl(url('/api/journal/export.pdf', journalQuery(filters.value)), { token: true });
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        busy.value = false;
    }
}

async function askZip(): Promise<void> {
    busy.value = true;
    try {
        zipEstimate.value = await estimate();
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        busy.value = false;
    }
}

async function downloadZip(): Promise<void> {
    zipEstimate.value = null;
    try {
        await downloadUrl(url('/api/journal/export.zip', journalQuery(filters.value)), { token: true });
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

function showOnMap(entry: JournalEntry): void {
    const center = entryPosition(entry);
    if (!center) return;
    mapStore.map.flyTo({ center, zoom: Math.max(mapStore.map.getZoom(), 15) });
}
</script>

<style scoped>
.journal-text {
    white-space: pre-wrap;
    word-break: break-word;
}

.journal-private {
    border-left: 3px solid var(--tblr-red, #d63939);
}

.journal-time {
    font-variant-numeric: tabular-nums;
}
</style>
