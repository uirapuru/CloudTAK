<template>
    <MenuTemplate
        :name='t("report.title")'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                :title='t("taklab.common.refresh")'
                @click='load'
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
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='form.scope'
                        :label='t("report.scope")'
                        :options='scopeOptions'
                        data-testid='report-scope'
                    />
                </div>
                <div
                    v-if='form.scope === "mission"'
                    class='col-12'
                >
                    <TranslatedEnum
                        v-if='feedOptions.length'
                        v-model='form.mission'
                        :label='t("report.feed")'
                        :options='feedOptions'
                        data-testid='report-feed'
                    />
                    <div
                        v-else
                        class='small text-muted px-2'
                        v-text='t("report.noFeeds")'
                    />
                </div>
                <div
                    v-if='needsPassword'
                    class='col-12'
                    data-testid='report-password'
                >
                    <TablerInput
                        v-model='form.password'
                        :label='t("report.password")'
                        type='password'
                        autocomplete='off'
                    />
                    <div
                        class='small text-muted px-2'
                        v-text='t("report.passwordHint")'
                    />
                </div>
                <div class='col-6'>
                    <TablerInput
                        v-model='form.since'
                        :label='t("report.since")'
                        type='datetime-local'
                        data-testid='report-since'
                    />
                </div>
                <div class='col-6'>
                    <TablerInput
                        v-model='form.until'
                        :label='t("report.until")'
                        type='datetime-local'
                        data-testid='report-until'
                    />
                </div>
                <div class='col-12 small text-muted px-3'>
                    {{ t('report.timezone') }}
                </div>
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='form.basemap'
                        :label='t("report.basemap")'
                        :options='basemapOptions'
                    />
                </div>
                <div
                    v-if='problem'
                    class='col-12 small text-red px-3'
                    data-testid='report-problem'
                    v-text='t(problem)'
                />
                <div
                    v-if='created'
                    class='col-12 small text-green px-3'
                    v-text='t("report.created")'
                />
                <div class='col-12'>
                    <button
                        class='btn btn-primary w-100'
                        :disabled='busy || Boolean(problem)'
                        data-testid='report-create'
                        @click='create'
                    >
                        {{ t('report.create') }}
                    </button>
                </div>
            </div>

            <div class='px-3 pt-3 small text-muted'>
                {{ t('report.list') }}
            </div>
            <TablerNone
                v-if='!jobs.length'
                :label='t("report.none")'
                :create='false'
            />
            <div
                v-else
                class='d-flex flex-column gap-2 py-2'
            >
                <StandardItem
                    v-for='job in jobs'
                    :key='job.id'
                    class='d-flex flex-column px-3 py-2 gap-1'
                    :data-job='job.id'
                >
                    <div class='d-flex align-items-start gap-2'>
                        <div class='flex-grow-1 d-flex flex-column overflow-hidden'>
                            <div class='d-flex align-items-center gap-2'>
                                <span
                                    class='fw-semibold text-truncate'
                                    v-text='job.mission ? t("report.mission", { name: job.mission }) : t("report.environment")'
                                />
                                <span
                                    class='badge'
                                    :class='statusClass(job.status)'
                                    data-testid='report-status'
                                    v-text='statusLabel(job.status)'
                                />
                            </div>
                            <span
                                class='small text-muted report-time'
                                v-text='t("report.range", { since: formatWhen(job.since, locale), until: formatWhen(job.until, locale) })'
                            />
                            <span
                                class='small text-muted'
                                v-text='t("report.owner", { owner: job.owner })'
                            />
                            <span
                                v-if='job.status === "failed" && job.error'
                                class='small text-red'
                                data-testid='report-error'
                                v-text='job.error'
                            />
                        </div>
                        <template v-if='job.status === "done"'>
                            <TablerIconButton
                                :title='t("report.downloadPdf")'
                                data-testid='report-pdf'
                                @click='download(job, "pdf")'
                            >
                                <IconFileTypePdf
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerIconButton
                                :title='t("report.downloadTxt")'
                                data-testid='report-txt'
                                @click='download(job, "txt")'
                            >
                                <IconFileText
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                        </template>
                        <TablerDelete
                            :title='t("report.delete")'
                            :label='t("report.deleteLabel")'
                            displaytype='icon'
                            @delete='remove(job)'
                        />
                    </div>
                </StandardItem>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
    IconFileText,
    IconFileTypePdf,
    IconRefresh,
} from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerDelete,
    TablerIconButton,
    TablerInput,
    TablerNone,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import { downloadUrl } from '../../../std.ts';
import { formatWhen } from './journal.ts';
import {
    REPORT_BASEMAPS,
    REPORT_POLL_MS,
    type ReportFeed,
    type ReportFormat,
    type ReportJob,
    createReport,
    defaultForm,
    deleteReport,
    feedRange,
    formProblem,
    isPending,
    listReports,
    reportUrl,
    subscribedFeeds,
    toRequest,
} from '../../../base/report.ts';

const { t, te, locale } = useI18n();
const route = useRoute();

const loading = ref(true);
const busy = ref(false);
const created = ref(false);
const error = ref<Error | undefined>();
const jobs = ref<ReportJob[]>([]);
const feeds = ref<ReportFeed[]>([]);
const form = ref(defaultForm());

let alive = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const selectedFeed = computed(() => feeds.value.find((f) => f.name === form.value.mission));
const needsPassword = computed(() => form.value.scope === 'mission' && Boolean(selectedFeed.value?.passwordProtected));
const problem = computed(() => formProblem(form.value));

const scopeOptions = computed(() => [
    { value: 'environment', label: t('report.scopes.environment') },
    { value: 'mission', label: t('report.scopes.mission') },
]);

const feedOptions = computed(() => [
    ...(form.value.mission ? [] : [{ value: '', label: t('report.chooseFeed') }]),
    ...feeds.value.map((f) => ({ value: f.name, label: f.name })),
]);

const basemapOptions = computed(() => REPORT_BASEMAPS.map((b) => ({ value: b, label: t(`report.basemaps.${b}`) })));

function statusLabel(status: string): string {
    const key = `report.statuses.${status}`;
    return te(key) ? t(key) : status;
}

function statusClass(status: string): string {
    if (status === 'done') return 'bg-green text-white';
    if (status === 'failed') return 'bg-red text-white';
    return 'bg-blue-lt';
}

/** Choose a feed and set the range from its creation to now. */
function chooseFeed(name: string): void {
    if (!feeds.value.some((f) => f.name === name)) {
        feeds.value = [...feeds.value, { name, createTime: null, passwordProtected: false }];
    }
    form.value.scope = 'mission';
    form.value.mission = name;
}

// A new feed starts with its own range and without the password of the previous one.
watch(() => form.value.mission, (name) => {
    form.value.password = '';
    if (name) Object.assign(form.value, feedRange(selectedFeed.value));
});

watch(() => route.query.mission, (mission) => {
    if (typeof mission === 'string' && mission) chooseFeed(mission);
});

onMounted(async () => {
    alive = true;
    try {
        feeds.value = await subscribedFeeds();
    } catch {
        feeds.value = [];
    }
    const mission = route.query.mission;
    if (typeof mission === 'string' && mission) chooseFeed(mission);
    await load();
    loading.value = false;
});

onUnmounted(() => {
    alive = false;
    if (pollTimer) clearTimeout(pollTimer);
});

/** Poll every 5 s, only while the menu is open and a report is queued or running. */
function schedule(): void {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
    if (!alive || !jobs.value.some(isPending)) return;
    pollTimer = setTimeout(() => { void load(); }, REPORT_POLL_MS);
}

async function load(): Promise<void> {
    try {
        jobs.value = await listReports();
        error.value = undefined;
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        schedule();
    }
}

async function create(): Promise<void> {
    if (problem.value) return;
    busy.value = true;
    created.value = false;
    try {
        await createReport(toRequest(form.value, selectedFeed.value));
        form.value.password = '';
        created.value = true;
        await load();
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        busy.value = false;
    }
}

async function download(job: ReportJob, fmt: ReportFormat): Promise<void> {
    try {
        await downloadUrl(reportUrl(job.id, fmt), { token: true });
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

async function remove(job: ReportJob): Promise<void> {
    try {
        await deleteReport(job.id);
        await load();
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}
</script>

<style scoped>
.report-time {
    font-variant-numeric: tabular-nums;
}
</style>
