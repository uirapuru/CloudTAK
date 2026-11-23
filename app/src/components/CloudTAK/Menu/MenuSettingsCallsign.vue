<template>
    <MenuTemplate :name='t("panels.settingsCallsign.title")'>
        <TablerLoading v-if='loading || !profile' />
        <div
            v-else
            class='col-12 d-flex flex-column gap-2 py-2'
        >
            <TablerInput
                v-model='search'
                icon='search'
                :placeholder='t("panels.settingsCallsign.search")'
            />

            <div class='d-flex flex-column gap-2'>
                <StandardItem
                    v-for='item of filteredSettings'
                    :key='item.key'
                    :hover='false'
                    class='position-relative'
                >
                    <Transition name='saved-fade'>
                        <div
                            v-if='savedKey === item.key'
                            class='saved-indicator position-absolute d-flex align-items-center gap-1'
                        >
                            <IconCircleCheck
                                :size='16'
                                stroke='1.5'
                                class='text-success'
                            />
                            <span class='text-success small fw-medium'>{{ t('common.saved') }}</span>
                        </div>
                    </Transition>
                    <div class='d-flex flex-column gap-2 px-3 py-3'>
                        <div class='d-flex align-items-center gap-3'>
                            <div
                                class='d-flex align-items-center justify-content-center rounded-circle bg-black bg-opacity-25 flex-shrink-0'
                                style='width: 40px; height: 40px;'
                            >
                                <component
                                    :is='item.icon'
                                    :size='24'
                                    stroke='1.5'
                                />
                            </div>
                            <div class='fw-bold text-white'>
                                {{ item.label }}
                            </div>
                        </div>
                        <div class='col-12'>
                            <TablerInput
                                v-if='item.type === "input"'
                                v-model='(profile as any)[item.key]'
                                :error='item.key === "tak_callsign" ? validateTextNotEmpty(profile.tak_callsign) : ""'
                                :required='item.key === "tak_callsign"'
                            />
                            <TablerInput
                                v-else-if='item.type === "seconds"'
                                v-model='locFreqSeconds'
                                type='number'
                                min='0'
                                step='0.1'
                            />
                            <TranslatedEnum
                                v-else-if='item.type === "enum"'
                                v-model='(profile as any)[item.key]'
                                :options='item.options || []'
                            />
                            <CoordinateType
                                v-else-if='item.type === "coordinate"'
                                v-model='profile.tak_type'
                                :size='24'
                            />
                        </div>
                        <div
                            v-if='(item.type === "input" || item.type === "seconds") && hasChanged(item.key)'
                            class='d-flex justify-content-end'
                        >
                            <button
                                class='btn btn-primary btn-sm'
                                :disabled='item.key === "tak_callsign" && !!validateTextNotEmpty(profile.tak_callsign)'
                                @click='saveField(item.key)'
                            >
                                {{ t('common.save') }}
                            </button>
                        </div>
                    </div>
                </StandardItem>

                <div
                    v-if='filteredSettings.length === 0'
                    class='text-center text-secondary py-4'
                >
                    {{ t('panels.settingsCallsign.noMatch', { search }) }}
                </div>
            </div>
        </div>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Component } from 'vue';
import {
    IconUser,
    IconUsers,
    IconShield,
    IconClock,
    IconMapPin,
    IconPhone,
    IconCircleCheck,
} from '@tabler/icons-vue';
import MenuTemplate from '../util/MenuTemplate.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import type { EnumOption } from '../util/TranslatedEnum.vue';
import CoordinateType from '../util/CoordinateType.vue';
import { normalizePointType } from '../../../utils/point-type.ts';
import StandardItem from '../util/StandardItem.vue';
import type { Profile } from '../../../../src/types.ts';
import Config from '../../../base/config.ts';
import type { FullConfig } from '../../../base/config.ts';
import {
    TablerInput,
    TablerLoading
} from '@tak-ps/vue-tabler';
import { validateTextNotEmpty } from '../../../utils/validators.ts';
import { useMapStore } from '../../../stores/map.ts';
import ProfileConfig from '../../../base/profile.ts';
const mapStore = useMapStore();
const { t } = useI18n();

type SettingItem = {
    key: string;
    label: string;
    icon: Component;
    type: 'input' | 'enum' | 'coordinate' | 'seconds';
    options?: EnumOption[];
};

const loading = ref(true);
const profile = ref<Profile | undefined>();
const groups = ref<Record<string, string>>({});
const search = ref('');
const savedKey = ref<string | undefined>();
const changedFields = ref<Set<string>>(new Set());
let previousValues: Record<string, unknown> = {};
let saveTimeout: ReturnType<typeof setTimeout> | undefined;

const roles = computed<EnumOption[]>(() => ['Team Member', 'Team Lead', 'HQ', 'Sniper', 'Medic', 'Forward Observer', 'RTO', 'K9'].map((value) => ({
    value,
    label: t(`panels.settingsCallsign.roles.${value.replace(/[^a-zA-Z0-9]+/g, '_')}`)
})));

const tak_groups = computed(() => {
    const result = [];
    for (const g in groups.value) {
        if (groups.value[g]) {
            result.push(`${g} - ${groups.value[g]}`);
        } else {
            result.push(g);
        }
    }

    return result;
});

const settings = computed<SettingItem[]>(() => {
    const items: SettingItem[] = [
        {
            key: 'tak_callsign',
            label: t('panels.settingsCallsign.callsign'),
            icon: IconUser,
            type: 'input',
        },
        {
            key: 'tak_phone',
            label: t('panels.settingsCallsign.phone'),
            icon: IconPhone,
            type: 'input',
        },
        {
            key: 'tak_group',
            label: t('panels.settingsCallsign.group'),
            icon: IconUsers,
            type: 'enum',
            options: tak_groups.value,
        },
        {
            key: 'tak_role',
            label: t('panels.settingsCallsign.role'),
            icon: IconShield,
            type: 'enum',
            options: roles.value,
        },
        {
            key: 'tak_loc_freq',
            label: t('panels.settingsCallsign.locFreq'),
            icon: IconClock,
            type: 'seconds',
        },
        {
            key: 'tak_type',
            label: t('panels.settingsCallsign.pointType'),
            icon: IconMapPin,
            type: 'coordinate',
        },
    ];

    return items;
});

const filteredSettings = computed(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return settings.value;
    return settings.value.filter((item) =>
        item.label.toLowerCase().includes(query)
    );
});

const locFreqSeconds = computed<number>({
    get: () => {
        const ms = profile.value?.tak_loc_freq;
        return typeof ms === 'number' ? Math.round(ms / 1000) : 0;
    },
    set: (seconds: number) => {
        if (!profile.value) return;
        profile.value.tak_loc_freq = Math.round((Number(seconds) || 0) * 1000);
    }
});

function hasChanged(key: string): boolean {
    return changedFields.value.has(key);
}

onMounted(async () => {
    loading.value = true;
    await fetchConfig();

    const p = {
        tak_callsign: (await ProfileConfig.get('tak_callsign'))?.value,
        tak_group: (await ProfileConfig.get('tak_group'))?.value,
        tak_role: (await ProfileConfig.get('tak_role'))?.value,
        tak_type: (await ProfileConfig.get('tak_type'))?.value,
        tak_loc_freq: (await ProfileConfig.get('tak_loc_freq'))?.value,
        tak_phone: (await ProfileConfig.get('tak_phone'))?.value
    } as Profile;

    if (p.tak_group && groups.value[p.tak_group]) {
        // @ts-expect-error We expect an enum of Colors
        p.tak_group = `${p.tak_group} - ${groups.value[p.tak_group]}`;
    }

    profile.value = p;

    for (const item of settings.value) {
        previousValues[item.key] = (profile.value as Profile)[item.key as keyof Profile];
    }

    loading.value = false;
});

const groupKeys: (keyof FullConfig)[] = [
    'group::Yellow',
    'group::Cyan',
    'group::Green',
    'group::Red',
    'group::Purple',
    'group::Orange',
    'group::Blue',
    'group::Magenta',
    'group::White',
    'group::Maroon',
    'group::Dark Blue',
    'group::Teal',
    'group::Dark Green',
    'group::Brown',
];

async function fetchConfig() {
    const config = await Config.list(groupKeys);
    const result: Record<string, string> = {};
    for (const key of groupKeys) {
        const val = config[key];
        result[key.replace('group::', '')] = val ? String(val) : '';
    }
    groups.value = result;
}

async function saveField(key: string) {
    if (!profile.value) return;

    const p = JSON.parse(JSON.stringify(profile.value)) as Profile;
    p.tak_group = p.tak_group.replace(/\s-\s.*$/, '') as Profile["tak_group"];

    await mapStore.worker.profile.update({
        [key]: (p as Profile)[key as keyof Profile]
    });

    if (key === 'tak_type') {
        mapStore.defaultPointType = normalizePointType(p.tak_type);
    }

    savedKey.value = key;
    changedFields.value.delete(key);
    previousValues[key] = (profile.value as Profile)[key as keyof Profile];

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        savedKey.value = undefined;
    }, 2000);
}

watch(
    () => profile.value,
    async (newProfile) => {
        if (!newProfile || loading.value) return;

        for (const item of settings.value) {
            const current = (newProfile as Profile)[item.key as keyof Profile];
            if (current !== previousValues[item.key]) {
                if (item.type === 'input' || item.type === 'seconds') {
                    // Track changed state for input fields (manual save)
                    changedFields.value.add(item.key);
                } else {
                    // Auto-save non-input fields
                    savedKey.value = item.key;

                    const p = JSON.parse(JSON.stringify(newProfile)) as Profile;
                    p.tak_group = p.tak_group.replace(/\s-\s.*$/, '') as Profile["tak_group"];

                    await mapStore.worker.profile.update({
                        [item.key]: (p as Profile)[item.key as keyof Profile]
                    });

                    if (item.key === 'tak_type') {
                        mapStore.defaultPointType = normalizePointType(p.tak_type);
                    }

                    previousValues[item.key] = current;

                    if (saveTimeout) clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(() => {
                        savedKey.value = undefined;
                    }, 2000);
                }
            }
        }
    },
    { deep: true }
);
</script>
