<template>
    <MenuTemplate
        :name='t("settings.display.title")'
        :loading='loading || !profile'
    >
        <template v-if='profile'>
            <div class='col-12 d-flex flex-column gap-2 py-2'>
                <TablerInput
                    v-model='search'
                    icon='search'
                    :placeholder='t("settings.display.search")'
                />

                <div class='d-flex flex-column gap-2'>
                    <StandardItem
                        v-if='languageMatches'
                        :hover='false'
                    >
                        <div class='d-flex flex-column gap-2 px-3 py-3'>
                            <div class='d-flex align-items-center gap-3'>
                                <div
                                    class='d-flex align-items-center justify-content-center rounded-circle bg-black bg-opacity-25 flex-shrink-0'
                                    style='width: 40px; height: 40px;'
                                >
                                    <IconLanguage
                                        :size='24'
                                        stroke='1.5'
                                    />
                                </div>
                                <div class='fw-bold text-white'>
                                    {{ t('common.language') }}
                                </div>
                            </div>
                            <div class='col-12'>
                                <TranslatedEnum
                                    v-model='language'
                                    :options='languageOptions'
                                />
                            </div>
                        </div>
                    </StandardItem>

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
                                    {{ itemLabel(item) }}
                                </div>
                            </div>
                            <div class='col-12'>
                                <TranslatedEnum
                                    v-if='item.type === "enum"'
                                    v-model='(profile as any)[item.key]'
                                    :options='itemOptions(item)'
                                />
                                <TablerToggle
                                    v-else
                                    v-model='(profile as any)[item.key]'
                                />
                            </div>
                        </div>
                    </StandardItem>

                    <div
                        v-if='filteredSettings.length === 0 && !languageMatches'
                        class='text-center text-secondary py-4'
                    >
                        {{ t('settings.display.noMatch', { search }) }}
                    </div>
                </div>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, toRaw, onMounted, watch } from 'vue';
import type { Component } from 'vue';
import {
    IconClock,
    IconTypography,
    IconRuler,
    IconMountain,
    IconPolygon,
    IconGauge,
    IconAtom,
    IconWorld,
    IconBrightness,
    IconCrosshair,
    IconZoomIn,
    IconRotate,
    IconCircleCheck,
    IconBulb,
    IconLanguage,
} from '@tabler/icons-vue';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import type { Profile, Profile_Update } from '../../../types.ts';
import {
    TablerInput,
    TablerToggle,
} from '@tak-ps/vue-tabler';
import { useI18n } from 'vue-i18n';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import { LOCALES, setLocale, currentLocale, type Locale } from '../../../i18n.ts';
import { useMapStore } from '../../../stores/map.ts';
import { useDeviceStore } from '../../../stores/device.ts';
import ProfileConfig from '../../../base/profile.ts';
import { COORD_MODES, type CoordMode } from '../../../utils/coordinateFormat.ts';
const mapStore = useMapStore();
const deviceStore = useDeviceStore();
const { t, te } = useI18n();

const languageOptions = LOCALES.map((l) => ({ value: l.value, label: l.label }));
const language = ref<string>(currentLocale());
watch(language, (value) => {
    setLocale(value as Locale);
});

type DisplayStyleMode = 'System Default' | 'Light' | 'Dark';
type DisplayProfile = Profile & {
    display_style?: DisplayStyleMode
};
type DisplayProfileUpdate = Profile_Update & {
    display_style?: DisplayStyleMode
};

type SettingItem = {
    key: string;
    icon: Component;
    type: 'enum' | 'toggle';
    options?: string[];
};

const loading = ref(false);
const profile = ref<DisplayProfile | undefined>();
const search = ref('');
const savedKey = ref<string | undefined>();
const coordFormatOptions = COORD_MODES.map((mode) => mode.value);
const styleOptions: DisplayStyleMode[] = ['System Default', 'Light', 'Dark'];

const settings: SettingItem[] = [
    {
        key: 'display_stale',
        icon: IconClock,
        type: 'enum',
        options: ['Immediate', '10 Minutes', '30 Minutes', '1 Hour', 'Never'],
    },
    {
        key: 'display_text',
        icon: IconTypography,
        type: 'enum',
        options: ['Small', 'Medium', 'Large'],
    },
    {
        key: 'display_distance',
        icon: IconRuler,
        type: 'enum',
        options: ['meter', 'kilometer', 'mile'],
    },
    {
        key: 'display_elevation',
        icon: IconMountain,
        type: 'enum',
        options: ['meter', 'feet'],
    },
    {
        key: 'display_area',
        icon: IconPolygon,
        type: 'enum',
        options: ['square meter', 'square feet', 'acre', 'hectare'],
    },
    {
        key: 'display_speed',
        icon: IconGauge,
        type: 'enum',
        options: ['m/s', 'km/h', 'mi/h'],
    },
    {
        key: 'display_radiation_dose',
        icon: IconAtom,
        type: 'enum',
        options: ['sieverts', 'rems'],
    },
    {
        key: 'display_projection',
        icon: IconWorld,
        type: 'enum',
        options: ['globe', 'mercator'],
    },
    {
        key: 'display_style',
        icon: IconBrightness,
        type: 'enum',
        options: styleOptions,
    },
    {
        key: 'display_coordinate',
        icon: IconCrosshair,
        type: 'enum',
        options: coordFormatOptions,
    },
    {
        key: 'display_zoom',
        icon: IconZoomIn,
        type: 'enum',
        options: ['always', 'conditional', 'never'],
    },
    {
        key: 'display_icon_rotation',
        icon: IconRotate,
        type: 'toggle',
    },
    {
        key: 'display_wakelock',
        icon: IconBulb,
        type: 'enum',
        options: ['Default', 'Charging', 'Always On'],
    },
];

function itemLabel(item: SettingItem): string {
    return t(`settings.display.items.${item.key}`);
}

// Stored values stay in English (they are what the API expects); only the text is translated.
function itemOptions(item: SettingItem): { value: string; label: string }[] {
    return (item.options || []).map((value) => {
        const key = `settings.display.values.${item.key}.${value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
        return { value, label: te(key) ? t(key) : value };
    });
}

function matches(text: string): boolean {
    const query = search.value.trim().toLowerCase();
    return !query || text.toLowerCase().includes(query);
}

const languageMatches = computed(() => matches(t('common.language')) || matches('language'));

const filteredSettings = computed(() => {
    return settings.filter((item) => matches(itemLabel(item)));
});

async function getProfile() {
    return {
        display_stale: (await ProfileConfig.get('display_stale'))?.value,
        display_text: (await ProfileConfig.get('display_text'))?.value,
        display_distance: (await ProfileConfig.get('display_distance'))?.value,
        display_elevation: (await ProfileConfig.get('display_elevation'))?.value,
        display_area: (await ProfileConfig.get('display_area'))?.value,
        display_speed: (await ProfileConfig.get('display_speed'))?.value,
        display_radiation_dose: (await ProfileConfig.get('display_radiation_dose'))?.value,
        display_projection: (await ProfileConfig.get('display_projection'))?.value,
        display_style: (await ProfileConfig.get('display_style' as keyof Profile))?.value as DisplayStyleMode | undefined,
        display_coordinate: (await ProfileConfig.get('display_coordinate'))?.value,
        display_zoom: (await ProfileConfig.get('display_zoom'))?.value,
        display_icon_rotation: (await ProfileConfig.get('display_icon_rotation'))?.value,
        display_wakelock: (await ProfileConfig.get('display_wakelock'))?.value,
    } as DisplayProfile;
}

onMounted(async () => {
    loading.value = true;
    profile.value = await getProfile();

    // Snapshot initial values so the watcher doesn't fire on first load
    for (const item of settings) {
        previousValues[item.key] = (profile.value as DisplayProfile)[item.key as keyof DisplayProfile];
    }

    loading.value = false;
});

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
let previousValues: Record<string, unknown> = {};

watch(
    () => profile.value,
    async (newProfile) => {
        if (!newProfile || loading.value) return;

        // Determine which key changed by comparing against the snapshot taken after last save
        for (const item of settings) {
            const current = (newProfile as DisplayProfile)[item.key as keyof DisplayProfile];
            if (current !== previousValues[item.key]) {
                savedKey.value = item.key;
                break;
            }
        }

        // Snapshot current values before the async save
        previousValues = {};
        for (const item of settings) {
            previousValues[item.key] = (newProfile as DisplayProfile)[item.key as keyof DisplayProfile];
        }

        await mapStore.worker.profile.update(toRaw(newProfile) as DisplayProfileUpdate);

        mapStore.updateDistanceUnit(newProfile.display_distance);
        mapStore.elevationUnit = newProfile.display_elevation;
        mapStore.speedUnit = newProfile.display_speed;

        // Immediately update coordinate format and icon rotation to avoid requiring page reload
        mapStore.coordFormat = (newProfile.display_coordinate as CoordMode) || 'dd';
        mapStore.updateIconRotation(newProfile.display_icon_rotation as unknown as boolean);

        await deviceStore.wakeLock.applyPreference(newProfile.display_wakelock);

        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            savedKey.value = undefined;
        }, 2000);
    },
    { deep: true }
);
</script>
