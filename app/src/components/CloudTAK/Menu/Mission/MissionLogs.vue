<template>
    <MenuTemplate
        :name='t("mission.logs.title")'
        :zindex='0'
        :back='false'
        :border='false'
        :loading='!logs'
        :standalone='false'
    >
        <template #buttons>
            <TablerIconButton :title='t("mission.logs.download")'>
                <IconDownload
                    :size='24'
                    stroke='1'
                    @click='exportLogs("csv")'
                />
            </TablerIconButton>
        </template>
        <template #default>
            <div
                v-if='logs && logs.length'
                class='col-12 pb-2 px-2'
            >
                <SearchSortFilter
                    v-model='paging.filter'
                    v-model:sort='sort'
                    :sort-options='sortOptions'
                    :active-filters='selectedKeywords.length'
                    :placeholder='t("mission.common.filter")'
                >
                    <template #sort-icon>
                        <template v-if='sort'>
                            <component
                                :is='sortTypeIcon'
                                :size='20'
                                stroke='1'
                            />
                            <component
                                :is='sortDirectionIcon'
                                :size='20'
                                stroke='1'
                            />
                        </template>
                        <IconArrowsSort
                            v-else
                            :size='20'
                            stroke='1'
                        />
                    </template>
                    <template #filters>
                        <div class='d-flex flex-column'>
                            <div class='d-flex align-items-center justify-content-between px-3 py-2'>
                                <strong class='small text-uppercase text-secondary'>{{ t('mission.logs.filters') }}</strong>
                                <button
                                    v-if='selectedKeywords.length'
                                    type='button'
                                    class='btn btn-link btn-sm p-0'
                                    @click='selectedKeywords = []'
                                >
                                    {{ t('mission.logs.clear') }}
                                </button>
                            </div>
                            <div class='px-3 pb-2 d-flex flex-column gap-2'>
                                <div>
                                    <div class='small text-uppercase text-secondary mb-1'>
                                        {{ t('mission.common.keywords') }}
                                    </div>
                                    <div
                                        v-if='!availableKeywords.length'
                                        class='small text-secondary'
                                    >
                                        {{ t('mission.logs.noKeywords') }}
                                    </div>
                                    <label
                                        v-for='keyword in availableKeywords'
                                        :key='keyword'
                                        class='form-check mb-1'
                                    >
                                        <input
                                            class='form-check-input'
                                            type='checkbox'
                                            :checked='selectedKeywords.includes(keyword)'
                                            @change='toggleKeyword(keyword)'
                                        >
                                        <span
                                            class='form-check-label'
                                            v-text='keyword'
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </template>
                </SearchSortFilter>
            </div>

            <TablerNone
                v-if='!filteredLogs.length'
                :create='false'
                :label='t("mission.logs.empty")'
            />
            <div
                v-else
                class='rows px-2 d-flex flex-column gap-3'
            >
                <MissionLogItem
                    v-for='log in filteredLogs'
                    :key='log.id'
                    :log='log'
                    :subscription='props.subscription'
                    :relevant='availableKeywords'
                />
            </div>
            <template v-if='props.subscription.role.permissions.includes("MISSION_WRITE")'>
                <div
                    class='px-2 position-relative'
                    :aria-busy='loading.create'
                >
                    <div
                        v-if='loading.create'
                        class='position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center cloudtak-scrim rounded-4 z-3'
                    >
                        <TablerLoading
                            :desc='t("mission.logs.creating")'
                            :compact='true'
                        />
                    </div>

                    <div class='d-flex justify-content-between align-items-center mb-2 pt-2'>
                        <label class='form-label mb-0'>{{ t('mission.logs.create') }}</label>
                        <TablerSelect
                            v-if='templateLogs.length'
                            v-model='selectedLogType'
                            :options='logTypeOptions'
                        />
                    </div>

                    <MessageComposer
                        v-if='!selectedTemplateLog'
                        ref='composer'
                        class='pb-2'
                        :placeholder='t("mission.logs.entryPlaceholder")'
                        :submit-label='t("mission.logs.save")'
                        :busy='loading.create'
                        @send='submitLog'
                    >
                        <Keywords
                            v-model:keywords='createLog.keywords'
                            :relevant='availableKeywords'
                        />
                    </MessageComposer>
                    <div v-else>
                        <TablerSchema
                            v-model='createLog.schema'
                            :schema='selectedTemplateLog.schema'
                        />

                        <div class='d-flex my-2'>
                            <div class='ms-auto'>
                                <TablerButton
                                    :loading='loading.create'
                                    @click='submitLog'
                                >
                                    {{ t('mission.logs.save') }}
                                </TablerButton>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, watch } from 'vue'
import { from } from 'rxjs';
import type { Ref, ComputedRef } from 'vue';
import Keywords from '../../util/Keywords.vue';
import MissionLogItem from './MissionLog.vue';
import MessageComposer from '../../util/MessageComposer.vue';
import SearchSortFilter from '../../util/SearchSortFilter.vue';
import MissionTemplateLogs from '../../../../base/mission-template-logs.ts';
import type { DBMissionTemplateLog, DBSubscriptionLog } from '../../../../database.ts';
import {
    TablerNone,
    TablerLoading,
    TablerIconButton,
    TablerSelect,
    TablerSchema,
    TablerButton
} from '@tak-ps/vue-tabler';
import {
    IconDownload,
    IconLetterCase,
    IconClock,
    IconArrowUp,
    IconArrowDown,
    IconArrowsSort,
} from '@tabler/icons-vue';
import { liveQuery } from '../../../../database.ts';
import MenuTemplate from '../../util/MenuTemplate.vue';
import Subscription from '../../../../base/subscription.ts';
import { useObservable } from "@vueuse/rxjs";
import { stringify } from 'yaml';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
    subscription: Subscription
}>();

const logs: Ref<Array<DBSubscriptionLog>> = useObservable(
    from(liveQuery(async () => {
        return await props.subscription.log.list()
    }))
)

const composer = ref<InstanceType<typeof MessageComposer>>();
const paging = ref({ filter: '' });
const sort = ref('');
const sortOptions = computed(() => [
    t('mission.layers.sort.newest'),
    t('mission.layers.sort.oldest'),
    t('mission.logs.sort.alphaAsc'),
    t('mission.logs.sort.alphaDesc'),
]);
// Index of the chosen option: 0 newest, 1 oldest, 2 A→Z, 3 Z→A, -1 none
const sortIndex = computed(() => sortOptions.value.indexOf(sort.value));
const selectedKeywords = ref<string[]>([]);
const sortTypeIcon = computed(() => (sortIndex.value === 2 || sortIndex.value === 3) ? IconLetterCase : IconClock);
const sortDirectionIcon = computed(() => (sortIndex.value === 1 || sortIndex.value === 2) ? IconArrowUp : IconArrowDown);
const createLog = ref<{
    keywords: string[];
    schema: Record<string, unknown>;
}>({
    keywords: [],
    schema: {}
});

const loading = ref<{
    logs: boolean,
    create: boolean,
}> ({
    logs: false,
    create: false,
});

const templateLogs = ref<DBMissionTemplateLog[]>([]);
const selectedLogType = ref(t('mission.logs.defaultType'));

const availableKeywords = computed<string[]>(() => {
    const set = new Set<string>();
    for (const log of (logs.value || [])) {
        for (const k of (log.keywords || [])) {
            if (!k.startsWith('template:')) set.add(k);
        }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
});

function toggleKeyword(keyword: string): void {
    const idx = selectedKeywords.value.indexOf(keyword);
    if (idx === -1) selectedKeywords.value.push(keyword);
    else selectedKeywords.value.splice(idx, 1);
}

const selectedTemplateLog = computed(() => {
    return templateLogs.value.find((l: DBMissionTemplateLog) => {
        return l.name === selectedLogType.value
    });
});

onMounted(async () => {
    await props.subscription?.log.read();

    if (props.subscription.templateid) {
        try {
            const tLogs = new MissionTemplateLogs(props.subscription.templateid);
            templateLogs.value = await tLogs.list({ refresh: true });
        } catch (e) {
            console.error(e);
        }
    }
});

const logTypeOptions = computed<Array<string>>(() => {
    return [t('mission.logs.defaultType'), ...templateLogs.value.map(l => l.name)];
});

const filteredLogs: ComputedRef<Array<DBSubscriptionLog>> = computed(() => {
    const allLogs = logs.value || [];
    const filter = paging.value.filter.toLowerCase().trim();

    let result = allLogs.filter((log: DBSubscriptionLog) => {
        if (filter && !log.content.toLowerCase().includes(filter)) return false;

        if (selectedKeywords.value.length) {
            const logKeywords = log.keywords || [];
            if (!selectedKeywords.value.some((k) => logKeywords.includes(k))) return false;
        }

        return true;
    });

    result = [...result].sort((a, b) => {
        if (sortIndex.value === 0) {
            return new Date(b.dtg ?? 0).getTime() - new Date(a.dtg ?? 0).getTime();
        } else if (sortIndex.value === 1) {
            return new Date(a.dtg ?? 0).getTime() - new Date(b.dtg ?? 0).getTime();
        } else if (sortIndex.value === 2) {
            return a.content.localeCompare(b.content);
        } else if (sortIndex.value === 3) {
            return b.content.localeCompare(a.content);
        }
        return 0;
    });

    return result;
});

watch(selectedTemplateLog, (log) => {
    createLog.value.keywords = [];

    if (log && log.keywords && log.keywords.length) {
        for (const keyword of log.keywords) {
            if (!createLog.value.keywords.includes(keyword)) {
                createLog.value.keywords.push(keyword);
            }
        }
    }
});

async function exportLogs(format: string): Promise<void> {
    await props.subscription.log.download(format);
}

/** A default Log carries the composer text; a template Log is built from its schema form */
async function submitLog(content?: string) {
    if (loading.value.create) return;
    if (!selectedTemplateLog.value && !(content || '').trim()) return;

    loading.value.logs = true;
    loading.value.create = true;

    try {
        if (selectedTemplateLog.value) {
            await props.subscription.log.create({
                content: stringify(createLog.value.schema),
                keywords: [...createLog.value.keywords, `template:${selectedTemplateLog.value.id}`]
            });
        } else {
            await props.subscription.log.create({
                content: (content || '').trim(),
                keywords: createLog.value.keywords,
            });
        }

        createLog.value.keywords = [];
        createLog.value.schema = {};
        await composer.value?.reset();
    } finally {
        loading.value.create = false;
        loading.value.logs = false;
    }
}
</script>
