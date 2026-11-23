<template>
    <MenuTemplate
        :name='t("panels.missionNew.title")'
    >
        <template #default>
            <TablerLoading
                v-if='loading'
                :desc='t("panels.missionNew.creating")'
            />
            <div
                v-else-if='created'
                class='row g-2 my-2'
            >
                <div class='col-12'>
                    <TablerAlert
                        v-if='error'
                        :err='error'
                    />
                </div>
                <div class='col-12'>
                    {{ t('panels.missionNew.notAdded') }}
                </div>
                <div class='col-12 my-3'>
                    <button
                        class='btn btn-primary w-100'
                        @click='loadMission'
                    >
                        {{ t('panels.missionNew.retry') }}
                    </button>
                </div>
            </div>
            <div
                v-else
                class='row g-2 my-2'
            >
                <div
                    v-if='error'
                    class='col-12'
                >
                    <TablerAlert :err='error' />
                </div>

                <div class='col-12'>
                    <TablerInput
                        v-model='mission.name'
                        :error='missionNameValidity'
                        :label='t("panels.missionNew.name")'
                    />
                </div>

                <div
                    v-if='templates.length || templatesLoading'
                    class='col-12'
                >
                    <div class='d-flex align-items-center mb-2'>
                        <label class='subheader my-0'>{{ t('panels.missionNew.templates') }}</label>
                        <div class='ms-auto'>
                            <TablerIconButton
                                v-if='!showSearch'
                                :title='t("panels.missionNew.searchTemplates")'
                                @click='showSearch = true'
                            >
                                <IconSearch
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                            <TablerIconButton
                                v-else
                                :title='t("panels.missionNew.closeSearch")'
                                @click='showSearch = false; templatesPaging.filter = "";'
                            >
                                <IconX
                                    :size='20'
                                    stroke='1'
                                />
                            </TablerIconButton>
                        </div>
                    </div>

                    <div
                        v-if='showSearch'
                        class='mb-2'
                    >
                        <TablerInput
                            v-model='templatesPaging.filter'
                            :placeholder='t("panels.missionNew.searchTemplatesPlaceholder")'
                            :autofocus='true'
                        />
                    </div>

                    <TablerLoading
                        v-if='templatesLoading'
                        :desc='t("panels.missionNew.loadingTemplates")'
                    />
                    <div
                        v-else-if='templates.length'
                        class='row g-2'
                    >
                        <div
                            v-for='template in templates'
                            :key='template.id'
                            class='col-4'
                            @click='selectedTemplate = template.id'
                        >
                            <div
                                class='card p-2 text-center cursor-pointer h-100 d-flex flex-column align-items-center justify-content-center'
                                :class='{ "bg-primary-lt": selectedTemplate === template.id }'
                            >
                                <img
                                    v-if='template.icon'
                                    :src='template.icon'
                                    class='mb-2'
                                    style='height: 32px; width: 32px; object-fit: contain;'
                                    :style='template.icon.includes("image/svg+xml") ? "filter: brightness(0) invert(1);" : ""'
                                >
                                <IconLayout
                                    v-else
                                    :size='32'
                                    stroke='1'
                                    class='mb-2'
                                />
                                <div class='small lh-1'>
                                    {{ template.name }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div
                        v-else
                        class='text-center fst-italic text-muted'
                    >
                        {{ t('panels.missionNew.noTemplates') }}
                    </div>
                </div>

                <div class='col-12'>
                    <small class='text-uppercase text-secondary d-block mb-1'>{{ t('panels.missionNew.description') }}</small>
                    <TablerInput
                        v-model='mission.description'
                        :rows='5'
                        :placeholder='t("panels.missionNew.noDescription")'
                    />
                </div>

                <div class='col-12'>
                    <label class='px-2 w-100'>{{ t('panels.missionNew.channels') }}</label>

                    <GroupSelect
                        v-model='mission.groups'
                        :active='true'
                        direction='IN'
                    />
                </div>

                <label
                    class='subheader mt-3 cursor-pointer'
                    @click='advanced = !advanced'
                >
                    <IconSquareChevronRight
                        v-if='!advanced'
                        :size='32'
                        stroke='1'
                    />
                    <IconChevronDown
                        v-else
                        :size='32'
                        stroke='1'
                    />
                    {{ t('panels.missionNew.advanced') }}
                </label>

                <div
                    v-if='advanced'
                    class='col-12'
                >
                    <div class='row g-2'>
                        <div class='col-12'>
                            <label class='px-2 w-100'>{{ t('panels.missionNew.keywords') }}</label>
                            <Keywords
                                :placeholder='t("panels.missionNew.enterKeywords")'
                                :keywords='mission.keywords'
                                :relevant='[]'
                                @update:keywords='mission.keywords = $event'
                            />
                        </div>

                        <div class='col-12'>
                            <TablerToggle
                                v-model='mission.passwordProtected'
                                :label='t("panels.missionNew.passwordProtected")'
                            />
                            <TablerInput
                                v-if='mission.passwordProtected'
                                v-model='mission.password'
                                :disabled='!mission.passwordProtected'
                                type='password'
                                autocomplete='new-password'
                                :label='t("panels.missionNew.password")'
                            />
                        </div>

                        <div class='col-12'>
                            <TranslatedEnum
                                v-model='mission.role'
                                :label='t("panels.missionNew.defaultRole")'
                                :options='roleOptions'
                            />
                        </div>
                    </div>
                </div>

                <div class='col-12 my-3'>
                    <button
                        class='btn btn-primary w-100'
                        @click='createMission'
                    >
                        {{ t('panels.missionNew.create') }}
                    </button>
                </div>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { server } from '../../../std.ts';
import type { Mission, Mission_Create, MissionTemplateList } from '../../../types.ts';
import {
    IconSquareChevronRight,
    IconChevronDown,
    IconSearch,
    IconX,
    IconLayout
} from '@tabler/icons-vue';
import MenuTemplate from '../util/MenuTemplate.vue';
import GroupSelect from '../util/GroupSelect.vue';
import Keywords from '../util/Keywords.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import OverlayManager from '../../../base/overlay.ts';
import {
    TablerInput,
    TablerToggle,
    TablerAlert,
    TablerLoading,
    TablerIconButton
} from '@tak-ps/vue-tabler';

const router = useRouter();
const { t } = useI18n();

const roleOptions = computed(() => [
    { value: 'Read-Only', label: t('panels.missionNew.roles.readOnly') },
    { value: 'Subscriber', label: t('panels.missionNew.roles.subscriber') },
    { value: 'Owner', label: t('panels.missionNew.roles.owner') },
]);

const attempted = ref(false);
const loading = ref(false);
const error = ref<Error | undefined>(undefined);
const created = ref<Mission | undefined>(undefined);
const advanced = ref(false);

const templates = ref<MissionTemplateList['items']>([]);
const templatesLoading = ref(false);
const showSearch = ref(false);

const templatesPaging = ref({
    filter: ''
});

const selectedTemplate = ref<string | null>(null);

const mission = ref({
    name: '',
    password: '',
    passwordProtected: false,
    role: 'Subscriber',
    description: '',
    groups: [],
    keywords: [] as string[],
    hashtags: ''
});

watch(selectedTemplate, (newId) => {
    const template = templates.value.find((t) => t.id === newId);

    mission.value.keywords = [];

    if (template && template.keywords) {
        for (const keyword of template.keywords) {
            if (!mission.value.keywords.includes(keyword)) {
                mission.value.keywords.push(keyword);
            }
        }
    }
});

watch(templatesPaging, async () => {
    await listTemplates();
}, { deep: true });

onMounted(async () => {
    await listTemplates();
});

async function listTemplates() {
    templatesLoading.value = true;

    const res = await server.GET('/api/template/mission', {
        params: {
            query: {
                limit: 10,
                sort: 'created',
                page: 0,
                order: 'desc',
                filter: templatesPaging.value.filter || ''
            }
        }
    })

    if (res.error) throw new Error(res.error.message);

    if (!res.data.items.length && !templatesPaging.value.filter) {
        templates.value = [];
    } else {
        templates.value = [{
            id: 'default',
            name: t('panels.missionNew.defaultTemplate'),
            icon: '',
            description: '',
            created: '',
            updated: '',
            keywords: [],
        }, ...res.data.items];

        if (!selectedTemplate.value) selectedTemplate.value = 'default';
    }
    templatesLoading.value = false;
}

const missionNameValidity = computed<string>(() => {
    // eslint-disable-next-line no-useless-escape
    if (!mission.value.name.match(/^[\p{L}\p{N}\w\d\s\.\(\)!=@#$&^*_\-\+\[\]\{\}:,\.\/\|\\]*$/u)) {
        return t('panels.missionNew.invalidChar')
    } else if (mission.value.name.length > 1024) {
        return t('panels.missionNew.tooLong')
    } else if (attempted.value && mission.value.name.length === 0) {
        return t('panels.missionNew.empty')
    }

    return '';
});

async function createMission() {
    attempted.value = true;

    if (missionNameValidity.value) return;

    loading.value = true;
    error.value = undefined;

    try {
        const body: Mission_Create = {
            name: mission.value.name,
            group: mission.value.groups,
            description: mission.value.description || '',
            keywords: mission.value.keywords || []
        };

        if (mission.value.role === 'Subscriber') body.defaultRole = 'MISSION_SUBSCRIBER';
        if (mission.value.role === 'Read-Only') body.defaultRole = 'MISSION_READONLY_SUBSCRIBER';
        if (mission.value.role === 'Owner') body.defaultRole = 'MISSION_OWNER';

        if (mission.value.passwordProtected) body.password = mission.value.password;

        if (selectedTemplate.value && selectedTemplate.value !== 'default') {
            if (!body.keywords) body.keywords = [];
            body.keywords.push(`template:${selectedTemplate.value}`);
        }

        const res = await server.POST('/api/marti/mission', {
            body
        });

        if (res.error) throw new Error(res.error.message);

        created.value = res.data;
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
        loading.value = false;
        return;
    }

    await loadMission();
}

async function loadMission() {
    if (!created.value) return;

    loading.value = true;
    error.value = undefined;

    try {
        await OverlayManager.createLoaded({
            name: created.value.name,
            url: `/mission/${encodeURIComponent(created.value.guid)}`,
            type: 'geojson',
            mode: 'mission',
            token: created.value.token,
            mode_id: created.value.guid,
        })

        await router.replace(`/menu/missions/${created.value.guid}`);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
        loading.value = false;
    }
}
</script>
