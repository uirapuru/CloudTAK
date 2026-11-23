<template>
    <MenuTemplate
        :name='t("panels.settingsPermissions.title")'
        :loading='loading'
    >
        <template #buttons>
            <TablerIconButton
                :title='t("panels.settingsPermissions.refresh")'
                :disabled='Boolean(working)'
                @click='refreshStatuses'
            >
                <IconRefresh
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>

        <div class='col-12 d-flex flex-column gap-2 py-3'>
            <div
                v-if='error'
                class='alert alert-warning mb-0'
                role='alert'
            >
                {{ error }}
            </div>

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
                            text-color='var(--tblr-body-color)'
                            class='text-uppercase flex-shrink-0'
                            v-bind='badgeProps(item.status)'
                        >
                            {{ badgeLabel(item.status) }}
                        </TablerBadge>
                    </div>

                    <div
                        v-if='shouldShowAction(item.key, item.status)'
                        class='d-flex justify-content-end'
                    >
                        <button
                            class='btn btn-primary'
                            :disabled='!canRequest(item.key, item.status) || working === item.key'
                            @click='requestPermission(item.key)'
                        >
                            {{ actionLabel(item.status, item.key) }}
                        </button>
                    </div>
                </div>
            </StandardItem>
        </div>

        <TablerModal
            v-if='disclosure'
            size='lg'
        >
            <LocationDisclosure
                :stage='disclosure'
                :settings='disclosureOpensSettings'
                :working='Boolean(working)'
                @accept='acceptDisclosure'
                @decline='disclosure = undefined'
            />
        </TablerModal>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import {
    IconBell,
    IconCamera,
    IconCompass,
    IconCurrentLocation,
    IconDatabase,
    IconFolderOpen,
    IconMapPin,
    IconRefresh,
    IconSun,
} from '@tabler/icons-vue';
import { TablerBadge, TablerIconButton, TablerModal } from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import LocationDisclosure from '../util/LocationDisclosure.vue';
import type { LocationDisclosureStage } from '../util/LocationDisclosure.vue';
import { addAppLifecycleListeners, isNativePlatform } from '../../../utils/capacitor.ts';
import { useMapStore } from '../../../stores/map.ts';
import { useDeviceStore } from '../../../stores/device.ts';
import type { BrowserPermissionState } from '../../../stores/device.ts';

const mapStore = useMapStore();
const deviceStore = useDeviceStore();
const { t } = useI18n();
type PermissionKey = 'location' | 'backgroundLocation' | 'notification' | 'orientation' | 'storage' | 'camera' | 'wakeLock' | 'fileSystem';
type PermissionDescriptor = {
    key: PermissionKey;
    icon: Component;
};

const loading = ref(true);
const error = ref('');
const working = ref<PermissionKey | undefined>();
const disclosure = ref<LocationDisclosureStage | undefined>();

const nativeOnly: PermissionKey[] = ['backgroundLocation'];
const webOnly: PermissionKey[] = ['storage', 'fileSystem'];
let removeLifecycleListeners: (() => void) | undefined;
let unmounted = false;

const permissionDescriptors: PermissionDescriptor[] = [{
    key: 'notification',
    icon: IconBell,
}, {
    key: 'camera',
    icon: IconCamera,
}, {
    key: 'location',
    icon: IconMapPin,
}, {
    key: 'backgroundLocation',
    icon: IconCurrentLocation,
}, {
    key: 'orientation',
    icon: IconCompass,
}, {
    key: 'storage',
    icon: IconDatabase,
}, {
    key: 'fileSystem',
    icon: IconFolderOpen,
}, {
    key: 'wakeLock',
    icon: IconSun,
}];

function permissionText(status: 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown', type: PermissionKey): string {
    return t(`panels.settingsPermissions.desc.${status}.${type}`);
}

function permissionTitle(type: PermissionKey): string {
    return t(`panels.settingsPermissions.titles.${type}`);
}

const permissionItems = computed(() => {
    return permissionDescriptors
        .filter((permission) => !(isNativePlatform() ? webOnly : nativeOnly).includes(permission.key))
        .map((permission) => {
            const status = deviceStore.permissions[permission.key];

            return {
                ...permission,
                title: permissionTitle(permission.key),
                status,
                description: descriptionFor(permission.key, status)
            };
        });
});

onMounted(async () => {
    await refreshStatuses();
    loading.value = false;

    // Pick up changes made in system settings
    const remove = await addAppLifecycleListeners({
        resume: () => { void refreshStatuses(); }
    });
    if (unmounted) remove();
    else removeLifecycleListeners = remove;
});

onBeforeUnmount(() => {
    unmounted = true;
    removeLifecycleListeners?.();
});

function badgeLabel(status: BrowserPermissionState): string {
    switch (status) {
        case 'granted': return t('panels.settingsPermissions.badge.allowed');
        case 'when_in_use': return t('panels.settingsPermissions.badge.whileUsing');
        case 'denied': return t('panels.settingsPermissions.badge.denied');
        case 'prompt': return t('panels.settingsPermissions.badge.notAsked');
        case 'unsupported': return t('panels.settingsPermissions.badge.unsupported');
        default: return t('panels.settingsPermissions.badge.unknown');
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

function descriptionFor(type: PermissionKey, status: BrowserPermissionState): string {
    if (status === 'when_in_use') {
        return t('panels.settingsPermissions.whenInUse');
    }

    if (isNativePlatform() && status !== 'granted' && status !== 'unsupported') {
        if (status === 'denied') return `${permissionText('denied', type).split('. ')[0]}.`;
        if (status === 'prompt') return permissionText('prompt', type);
        return permissionText('unknown', type);
    }

    switch (status) {
        case 'granted':
            return permissionText('granted', type);
        case 'denied':
            return permissionText('denied', type);
        case 'prompt':
            return permissionText('prompt', type);
        case 'unsupported':
            return permissionText('unsupported', type);
        default:
            return permissionText('unknown', type);
    }
}

// Native location prompts are only shown from behind the disclosure; a
// denied permission is re-granted from system settings.
function offersNativeRequest(type: PermissionKey, status: BrowserPermissionState): boolean {
    if (!isNativePlatform()) return false;
    if (type === 'location' || type === 'camera' || type === 'notification') {
        return status === 'prompt' || status === 'denied';
    }
    if (type === 'backgroundLocation') {
        return deviceStore.permissions.location === 'granted'
            && ['prompt', 'when_in_use', 'denied'].includes(status);
    }
    return false;
}

const disclosureOpensSettings = computed(() => {
    const type = disclosure.value === 'background' ? 'backgroundLocation' : 'location';
    return isNativePlatform() && deviceStore.permissions[type] === 'denied';
});

function canRequest(type: PermissionKey, status: BrowserPermissionState): boolean {
    if (offersNativeRequest(type, status)) return true;
    if (isNativePlatform()) return false;

    if (type === 'orientation' && !deviceStore.orientation.hasPermissionRequest() && status !== 'granted') {
        return false;
    }

    return status !== 'granted' && status !== 'unsupported';
}

function shouldShowAction(type: PermissionKey, status: BrowserPermissionState): boolean {
    if (offersNativeRequest(type, status)) return true;
    return !isNativePlatform() && status !== 'granted' && status !== 'unsupported';
}

function actionLabel(status: BrowserPermissionState, type: PermissionKey): string {
    if (working.value === type) return t('panels.settingsPermissions.action.requesting');
    if (isNativePlatform() && status === 'denied') return t('panels.settingsPermissions.action.openSettings');
    if (type === 'orientation' && !deviceStore.orientation.hasPermissionRequest() && status !== 'granted') return t('panels.settingsPermissions.action.unavailable');
    if (status === 'denied') return t('panels.settingsPermissions.action.reRequest');
    if (status === 'granted') return t('panels.settingsPermissions.action.allowed');
    return t('panels.settingsPermissions.action.request');
}

async function refreshStatuses(): Promise<void> {
    error.value = '';

    try {
        await deviceStore.refreshPermissionStatuses();
    } catch (err) {
        error.value = err instanceof Error ? err.message : t('panels.settingsPermissions.refreshFailed');
    }
}

// Location consent is collected on the disclosure before any system prompt
// or settings hand-off (Play prominent disclosure requirement).
async function requestPermission(type: PermissionKey): Promise<void> {
    if (type === 'location' || type === 'backgroundLocation') {
        error.value = '';
        disclosure.value = type === 'backgroundLocation' ? 'background' : 'location';
        return;
    }

    if (isNativePlatform() && !offersNativeRequest(type, deviceStore.permissions[type])) return;

    await runRequest(type);
}

async function acceptDisclosure(): Promise<void> {
    const type: PermissionKey = disclosure.value === 'background' ? 'backgroundLocation' : 'location';
    disclosure.value = undefined;
    await runRequest(type);
}

async function runRequest(type: PermissionKey): Promise<void> {
    error.value = '';
    working.value = type;

    try {
        if (isNativePlatform() && deviceStore.permissions[type] === 'denied') {
            await deviceStore.geolocation.openNativeSettings();
            return;
        }

        switch (type) {
            case 'location':
                await deviceStore.geolocation.request(() => {
                    void mapStore.startLocationWatch();
                });
                break;
            case 'backgroundLocation':
                await deviceStore.geolocation.requestBackground();
                break;
            case 'camera':
                await deviceStore.camera.request();
                break;
            case 'orientation':
                await deviceStore.orientation.request();
                break;
            case 'fileSystem':
                await deviceStore.fileSystem.request();
                break;
            case 'storage':
                await deviceStore.storage.request();
                break;
            case 'wakeLock':
                await deviceStore.wakeLock.request();
                break;
            case 'notification':
                await deviceStore.notification.request();
                break;
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : t('panels.settingsPermissions.requestFailed', { permission: permissionTitle(type) });
    } finally {
        working.value = undefined;
        await refreshStatuses();
    }
}
</script>
