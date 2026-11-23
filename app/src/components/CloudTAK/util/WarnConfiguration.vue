<template>
    <TablerModal size='lg'>
        <div
            class='modal-status'
            :class='current === "disclosure" ? "bg-blue" : "bg-red"'
        />
        <div class='modal-header'>
            <div class='d-flex align-items-center'>
                <IconMapPin
                    v-if='current === "disclosure"'
                    :size='28'
                    stroke='1'
                />
                <IconInfoSquare
                    v-else
                    :size='28'
                    stroke='1'
                />
                <span class='mx-2'>{{ title }}</span>
            </div>
        </div>
        <div class='modal-body'>
            <template v-if='current === "details"'>
                <TablerLoading v-if='loading' />
                <template v-else>
                    <p class='text-secondary'>
                        {{ t('util.warnConfiguration.detailsIntro') }}
                    </p>

                    <div class='row g-3'>
                        <div class='col-12'>
                            <TablerInput
                                v-model='form.tak_callsign'
                                :label='t("util.warnConfiguration.callsign")'
                                :description='t("util.warnConfiguration.callsignHelp")'
                                :placeholder='t("util.warnConfiguration.callsignPlaceholder")'
                                :autofocus='true'
                                :required='true'
                                :error='callsignError'
                                @keyup.enter='submitDetails'
                            />
                        </div>
                        <div class='col-12 col-md-6'>
                            <TablerEnum
                                v-model='form.tak_group'
                                :label='t("util.warnConfiguration.team")'
                                :options='groupOptions'
                            />
                        </div>
                        <div class='col-12 col-md-6'>
                            <TranslatedEnum
                                v-model='form.tak_role'
                                :label='t("util.warnConfiguration.role")'
                                :options='roleOptions'
                            />
                        </div>
                        <div class='col-12'>
                            <TablerInput
                                v-model='form.tak_phone'
                                :label='t("util.warnConfiguration.phone")'
                                :description='t("util.warnConfiguration.phoneHelp")'
                                type='tel'
                            />
                        </div>
                    </div>
                </template>
            </template>
            <template v-else-if='current === "disclosure"'>
                <p>{{ disclosureLead }}</p>

                <div class='card mb-3'>
                    <ul class='card-body list-unstyled d-flex flex-column gap-2 mb-0'>
                        <li>{{ t('util.locationDisclosure.sentToServer') }}</li>
                        <li>{{ t('util.locationDisclosure.adminControls') }}</li>
                        <li>{{ t('util.locationDisclosure.noAdvertising') }}</li>
                    </ul>
                </div>

                <p class='text-secondary mb-0'>
                    {{ disclosureNext }}
                </p>
            </template>
            <template v-else>
                <p class='text-secondary'>
                    {{ t('util.warnConfiguration.permissionsIntro') }}
                </p>

                <div
                    v-if='error'
                    class='alert alert-warning'
                    role='alert'
                >
                    {{ error }}
                </div>

                <div class='d-flex flex-column gap-2'>
                    <StandardItem
                        v-for='item of permissionItems'
                        :key='item.key'
                        :hover='false'
                    >
                        <div class='d-flex flex-column gap-3 px-3 py-3'>
                            <div class='d-flex align-items-start justify-content-between gap-3'>
                                <div class='d-flex align-items-start gap-3 flex-grow-1'>
                                    <component
                                        :is='item.icon'
                                        :size='30'
                                        stroke='1.5'
                                        class='flex-shrink-0 mt-1'
                                    />

                                    <div class='flex-grow-1'>
                                        <div class='fw-bold'>
                                            {{ item.title }}
                                        </div>

                                        <div class='text-secondary small mt-1'>
                                            {{ item.description }}
                                        </div>
                                    </div>
                                </div>

                                <TablerBadge
                                    class='text-uppercase flex-shrink-0'
                                    v-bind='badgeProps(item.status)'
                                >
                                    {{ badgeLabel(item.status) }}
                                </TablerBadge>
                            </div>

                            <div
                                v-if='!item.satisfied'
                                class='d-flex justify-content-end'
                            >
                                <button
                                    class='btn btn-primary'
                                    :disabled='working === item.key'
                                    @click='requestPermission(item.key)'
                                >
                                    {{ actionLabel(item.key, item.status) }}
                                </button>
                            </div>
                        </div>
                    </StandardItem>
                </div>
            </template>
        </div>
        <div class='modal-footer'>
            <template v-if='current === "details"'>
                <div class='ms-auto'>
                    <button
                        class='btn btn-primary'
                        :disabled='loading || saving || !!callsignError'
                        @click='submitDetails'
                    >
                        <TablerLoading
                            v-if='saving'
                            :inline='true'
                        />
                        <span v-else>{{ t('util.warnConfiguration.getStarted') }}</span>
                    </button>
                </div>
            </template>
            <template v-else-if='current === "disclosure"'>
                <button
                    class='btn btn-link text-secondary px-0'
                    :disabled='Boolean(working)'
                    @click='current = "permissions"'
                >
                    {{ t('util.locationDisclosure.notNow') }}
                </button>
                <div class='ms-auto'>
                    <button
                        class='btn btn-primary'
                        :disabled='Boolean(working)'
                        @click='acceptDisclosure'
                    >
                        {{ working ? t('util.locationDisclosure.requesting') : t('util.locationDisclosure.agree') }}
                    </button>
                </div>
            </template>
            <template v-else>
                <button
                    class='btn btn-link text-secondary px-0'
                    :disabled='Boolean(working)'
                    @click='dismissPermissions'
                >
                    {{ t('util.warnConfiguration.skip') }}
                </button>
                <div class='ms-auto btn-list'>
                    <button
                        class='btn btn-secondary'
                        :disabled='Boolean(working)'
                        @click='refreshStatuses'
                    >
                        {{ t('util.warnConfiguration.refresh') }}
                    </button>
                    <button
                        class='btn btn-primary'
                        :disabled='!permissionsSatisfied'
                        @click='emit("close")'
                    >
                        {{ t('util.common.done') }}
                    </button>
                </div>
            </template>
        </div>
    </TablerModal>
</template>

<script lang='ts'>
import { isNativePlatform, isAndroidPlatform, isIOSPlatform } from '../../../utils/capacitor.ts';

export type WarnConfigurationPage = 'details' | 'permissions';

const PERMISSIONS_DISMISSED_KEY = 'cloudtak-permissions-dismissed';

// Browser permissions are per-browser, so the dismissal is local; native always re-prompts
export function isPermissionsWarningDismissed(): boolean {
    if (isNativePlatform() || typeof window === 'undefined') return false;

    try {
        return localStorage.getItem(PERMISSIONS_DISMISSED_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setPermissionsWarningDismissed(): void {
    if (isNativePlatform() || typeof window === 'undefined') return;

    try {
        localStorage.setItem(PERMISSIONS_DISMISSED_KEY, 'true');
    } catch (err) {
        console.warn('Failed to persist permissions dismissal', err);
    }
}
</script>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed, onMounted } from 'vue';
import type { Component, PropType } from 'vue';
import {
    TablerModal,
    TablerInput,
    TablerEnum,
    TablerBadge,
    TablerLoading,
} from '@tak-ps/vue-tabler';
import {
    IconBell,
    IconInfoSquare,
    IconMapPin,
} from '@tabler/icons-vue';
import StandardItem from './StandardItem.vue';
import TranslatedEnum from './TranslatedEnum.vue';
import type { Profile } from '../../../types.ts';
import Config from '../../../base/config.ts';
import type { FullConfig } from '../../../base/config.ts';
import ProfileConfig from '../../../base/profile.ts';
import { validateTextNotEmpty } from '../../../utils/validators.ts';
import { useMapStore } from '../../../stores/map.ts';
import { useDeviceStore } from '../../../stores/device.ts';
import type { BrowserPermissionState, BrowserPermissionType } from '../../../stores/device.ts';

const { t } = useI18n();

const mapStore = useMapStore();
const deviceStore = useDeviceStore();

const props = defineProps({
    page: {
        type: String as PropType<WarnConfigurationPage>,
        default: 'details'
    }
});

const emit = defineEmits([ 'close' ]);

type ModalPage = WarnConfigurationPage | 'disclosure';

const current = ref<ModalPage>(props.page);

const title = computed(() => {
    switch (current.value) {
        case 'details': return t('util.warnConfiguration.welcome');
        case 'disclosure': return t('util.locationDisclosure.titleLocation');
        default: return t('util.warnConfiguration.permissions');
    }
});

// --- User Details ---

const roles: Profile['tak_role'][] = ['Team Member', 'Team Lead', 'HQ', 'Sniper', 'Medic', 'Forward Observer', 'RTO', 'K9'];

const roleOptions = computed(() => roles.map((value) => {
    return { value, label: t(`util.common.roles.${value.replace(/[^a-zA-Z0-9]+/g, '_')}`) };
}));

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

const loading = ref(true);
const saving = ref(false);
const groups = ref<Record<string, string>>({});

const form = ref({
    tak_callsign: '',
    tak_group: '',
    tak_role: '' as Profile['tak_role'],
    tak_phone: '',
});

const groupOptions = computed(() => {
    return Object.entries(groups.value).map(([name, description]) => {
        return description ? `${name} - ${description}` : name;
    });
});

const callsignError = computed(() => validateTextNotEmpty(form.value.tak_callsign));

onMounted(async () => {
    if (current.value !== 'details') return;

    const config = await Config.list(groupKeys);
    const result: Record<string, string> = {};
    for (const key of groupKeys) {
        const val = config[key];
        result[key.replace('group::', '')] = val ? String(val) : '';
    }
    groups.value = result;

    const group = (await ProfileConfig.get('tak_group'))?.value;
    const role = (await ProfileConfig.get('tak_role'))?.value;
    const phone = (await ProfileConfig.get('tak_phone'))?.value;
    const callsign = (await ProfileConfig.get('tak_callsign'))?.value;

    form.value.tak_group = group && groups.value[group]
        ? `${group} - ${groups.value[group]}`
        : (group || groupOptions.value[0] || '');
    form.value.tak_role = role || roles[0];
    form.value.tak_phone = phone || '';
    // taklab: pole zaczyna od znaku z profilu (domyslnie HQ), nie od pustego.
    form.value.tak_callsign = callsign && callsign !== 'CloudTAK User' ? String(callsign) : 'HQ';

    loading.value = false;
});

async function submitDetails() {
    if (callsignError.value || saving.value) return;

    saving.value = true;
    try {
        const group = form.value.tak_group.replace(/\s-\s.*$/, '');

        await mapStore.worker.profile.update({
            tak_callsign: form.value.tak_callsign.trim(),
            tak_role: form.value.tak_role,
            tak_phone: form.value.tak_phone.trim(),
            ...(group ? { tak_group: group as Profile['tak_group'] } : {}),
        });
    } finally {
        saving.value = false;
    }

    if (deviceStore.hasRequiredPermissions()) {
        emit('close');
    } else {
        current.value = 'permissions';
    }
}

// --- Permissions ---

type PermissionDescriptor = {
    key: BrowserPermissionType;
    title: string;
    description: string;
    icon: Component;
};

const permissionDescriptors = computed<Record<string, PermissionDescriptor>>(() => ({
    location: {
        key: 'location',
        title: t('util.warnConfiguration.location'),
        description: isNativePlatform()
            ? t('util.warnConfiguration.locationNative')
            : t('util.warnConfiguration.locationBrowser'),
        icon: IconMapPin,
    },
    notification: {
        key: 'notification',
        title: t('util.warnConfiguration.notifications'),
        description: t('util.warnConfiguration.notificationsHelp'),
        icon: IconBell,
    },
}));

const error = ref('');
const working = ref<BrowserPermissionType | undefined>();

const permissionItems = computed(() => {
    return deviceStore.requiredPermissions
        .map((key) => permissionDescriptors.value[key])
        .filter((item): item is PermissionDescriptor => !!item)
        .map((item) => ({
            ...item,
            status: deviceStore.permissions[item.key],
            satisfied: deviceStore.isPermissionSatisfied(item.key),
        }));
});

const permissionsSatisfied = computed(() => deviceStore.hasRequiredPermissions());

const disclosureLead = computed(() => {
    return isNativePlatform()
        ? t('util.locationDisclosure.leadNative')
        : t('util.locationDisclosure.leadBrowser');
});

const disclosureNext = computed(() => {
    const always = isAndroidPlatform() ? t('util.locationDisclosure.alwaysAndroid') : t('util.locationDisclosure.alwaysIOS');

    if (needsNativeSettings(deviceStore.permissions.location)) {
        return t('util.locationDisclosure.nextBackgroundSettings', { always });
    } else if (isAndroidPlatform()) {
        return t('util.warnConfiguration.nextAndroid');
    } else if (isIOSPlatform()) {
        return t('util.warnConfiguration.nextIOS');
    }

    return t('util.locationDisclosure.nextBrowser');
});

function badgeLabel(status: BrowserPermissionState): string {
    switch (status) {
        case 'granted': return t('util.warnConfiguration.status.granted');
        case 'when_in_use': return t('util.warnConfiguration.status.whenInUse');
        case 'denied': return t('util.warnConfiguration.status.denied');
        case 'prompt': return t('util.warnConfiguration.status.prompt');
        case 'unsupported': return t('util.warnConfiguration.status.unsupported');
        default: return t('util.warnConfiguration.status.prompt');
    }
}

function badgeProps(status: BrowserPermissionState): Record<string, string> {
    switch (status) {
        case 'unsupported':
        case 'when_in_use':
            return {
                backgroundColor: 'rgba(249, 115, 22, 0.18)',
                borderColor: 'rgba(234, 88, 12, 0.35)',
                textColor: '#fdba74'
            };
        case 'granted':
            return {};
        default:
            return {
                backgroundColor: 'rgba(220, 38, 38, 0.16)',
                borderColor: 'rgba(185, 28, 28, 0.32)',
                textColor: '#fca5a5'
            };
    }
}

// iOS never re-shows a system prompt after a denial, so only then do we
// fall back to the settings app; otherwise the in-app request drives the
// system dialogs (Share Location, then the Always upgrade).
function needsNativeSettings(status: BrowserPermissionState): boolean {
    return isNativePlatform() && status === 'denied';
}

function actionLabel(type: BrowserPermissionType, status: BrowserPermissionState): string {
    if (working.value === type) return t('util.locationDisclosure.requesting');
    if (needsNativeSettings(status)) return t('util.drawOverlay.openSettings');
    if (status === 'denied') return t('util.warnConfiguration.reRequest');
    return t('util.warnConfiguration.request');
}

function dismissPermissions(): void {
    setPermissionsWarningDismissed();
    emit('close');
}

async function refreshStatuses(): Promise<void> {
    error.value = '';

    try {
        await deviceStore.refreshPermissionStatuses();
    } catch (err) {
        error.value = err instanceof Error ? err.message : t('util.warnConfiguration.refreshFailed');
    }
}

// Location consent is collected on the disclosure page before any system
// prompt or settings hand-off (Play prominent disclosure requirement).
async function requestPermission(type: BrowserPermissionType): Promise<void> {
    if (type === 'location') {
        error.value = '';
        current.value = 'disclosure';
        return;
    }

    await runRequest(type);
}

async function acceptDisclosure(): Promise<void> {
    await runRequest('location');
    current.value = 'permissions';
}

async function runRequest(type: BrowserPermissionType): Promise<void> {
    error.value = '';
    working.value = type;

    try {
        if (needsNativeSettings(deviceStore.permissions[type])) {
            await deviceStore.geolocation.openNativeSettings();
        } else if (type === 'location') {
            await deviceStore.geolocation.request(() => {
                void mapStore.startLocationWatch();
            });
        } else if (type === 'notification') {
            await deviceStore.notification.request();
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : t('util.warnConfiguration.requestFailed', { type });
    } finally {
        working.value = undefined;
        await refreshStatuses();
    }
}
</script>
