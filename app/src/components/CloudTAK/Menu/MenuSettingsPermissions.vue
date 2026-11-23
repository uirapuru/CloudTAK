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
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { computed, onMounted, ref } from 'vue';
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
import { TablerBadge, TablerIconButton } from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import { isNativePlatform } from '../../../utils/capacitor.ts';
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
    if (status === 'granted' && type === 'notification') return t('panels.settingsPermissions.desc.granted.notificationBrowser');
    if (status === 'denied' && type === 'backgroundLocation') return t('panels.settingsPermissions.desc.denied.backgroundLocationBlocked');
    return t(`panels.settingsPermissions.desc.${status}.${type}`);
}

function permissionTitle(type: PermissionKey): string {
    return t(`panels.settingsPermissions.titles.${type}`);
}

const permissionItems = computed(() => {
    return permissionDescriptors
        .filter((permission) => permission.key !== 'backgroundLocation' || isNativePlatform())
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
});

function badgeLabel(status: BrowserPermissionState): string {
    switch (status) {
        case 'granted': return t('panels.settingsPermissions.badge.allowed');
        case 'when_in_use': return t('panels.settingsPermissions.badge.whileUsing');
        case 'denied': return t('panels.settingsPermissions.badge.reRequest');
        case 'prompt': return t('panels.settingsPermissions.badge.request');
        case 'unsupported': return t('panels.settingsPermissions.badge.unsupported');
        default: return t('panels.settingsPermissions.badge.request');
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

// Background location on native is granted from system settings, not an
// in-app prompt - offer to open them instead of a permission request.
function offersNativeSettings(type: PermissionKey, status: BrowserPermissionState): boolean {
    return isNativePlatform()
        && type === 'backgroundLocation'
        && (status === 'when_in_use' || status === 'denied');
}

function canRequest(type: PermissionKey, status: BrowserPermissionState): boolean {
    if (offersNativeSettings(type, status)) return true;
    if (isNativePlatform()) return false;

    if (type === 'orientation' && !deviceStore.orientation.hasPermissionRequest() && status !== 'granted') {
        return false;
    }

    return status !== 'granted' && status !== 'unsupported';
}

function shouldShowAction(type: PermissionKey, status: BrowserPermissionState): boolean {
    if (offersNativeSettings(type, status)) return true;
    return !isNativePlatform() && status !== 'granted' && status !== 'unsupported';
}

function actionLabel(status: BrowserPermissionState, type: PermissionKey): string {
    if (offersNativeSettings(type, status)) return t('panels.settingsPermissions.action.openSettings');
    if (working.value === type) return t('panels.settingsPermissions.action.requesting');
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

async function requestPermission(type: PermissionKey): Promise<void> {
    if (isNativePlatform()) {
        if (type !== 'backgroundLocation') return;

        error.value = '';
        working.value = type;

        try {
            await deviceStore.geolocation.openNativeSettings();
        } catch (err) {
            error.value = err instanceof Error ? err.message : t('panels.settingsPermissions.openSettingsFailed');
        } finally {
            working.value = undefined;
            await refreshStatuses();
        }

        return;
    }

    error.value = '';
    working.value = type;

    try {
        switch (type) {
            case 'location':
                await deviceStore.geolocation.request(() => {
                    void mapStore.startLocationWatch();
                });
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
