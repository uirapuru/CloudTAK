<template>
    <MenuTemplate :name='t("menu.areaPackages.title")'>
        <template #buttons>
            <TablerIconButton
                :title='t("menu.areaPackages.new")'
                data-test='new'
                @click='selectArea'
            >
                <IconPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
            <TablerRefreshButton
                :loading='loading'
                @click='fetchList'
            />
        </template>
        <template #default>
            <div
                v-if='selecting'
                class='alert alert-info m-2'
                v-text='t("menu.areaPackages.selecting")'
            />

            <TablerAlert
                v-if='error'
                :err='error'
            />

            <div
                v-if='!loading && !packages.length'
                class='text-secondary text-center p-4'
                v-text='t("menu.areaPackages.empty")'
            />

            <div
                v-for='p in packages'
                :key='p.id'
                class='area-package border-bottom p-3'
            >
                <div class='d-flex align-items-center'>
                    <div class='flex-grow-1'>
                        <div
                            class='fw-bold'
                            v-text='p.name'
                        />
                        <div class='text-secondary small'>
                            <span v-text='new Date(p.created).toLocaleString()' />
                            <span
                                v-if='p.status === "Success"'
                                v-text='` · ${formatBytes(p.size)}`'
                            />
                        </div>
                    </div>
                    <template v-if='p.status === "Success" && qrs[p.id]'>
                        <TablerIconButton
                            :title='t("menu.areaPackages.showQr")'
                            data-test='qr-toggle'
                            @click='toggleQr(p.id)'
                        >
                            <IconQrcode
                                :size='24'
                                stroke='1'
                            />
                        </TablerIconButton>
                        <a
                            class='btn btn-icon btn-ghost-secondary border-0'
                            data-test='download'
                            :href='qrs[p.id].url'
                            :title='t("menu.areaPackages.download")'
                            :aria-label='t("menu.areaPackages.download")'
                            download
                        >
                            <IconDownload
                                :size='24'
                                stroke='1'
                            />
                        </a>
                    </template>
                    <TablerIconButton
                        :title='t("menu.areaPackages.delete")'
                        data-test='delete'
                        @click='confirmDelete = p'
                    >
                        <IconTrash
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>

                <div
                    v-if='p.status === "Pending" || p.status === "Running"'
                    class='mt-2'
                >
                    <div class='progress progress-sm'>
                        <div
                            class='progress-bar'
                            :style='{ width: `${p.progress}%` }'
                        />
                    </div>
                    <div
                        class='text-secondary small mt-1'
                        v-text='t("menu.areaPackages.building", { progress: p.progress })'
                    />
                </div>

                <div
                    v-else-if='p.status === "Fail"'
                    class='text-danger small mt-2'
                    v-text='t("menu.areaPackages.failed", { error: p.error ?? "" })'
                />

                <template v-else-if='p.status === "Success" && qrs[p.id]'>
                    <template v-if='openQr.has(p.id)'>
                        <img
                            class='area-package__qr d-block mx-auto my-2'
                            data-test='qr'
                            :data-uri='qrs[p.id].uri'
                            :alt='t("menu.areaPackages.qrAlt")'
                            :src='`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrs[p.id].svg)}`'
                        >
                        <div
                            class='text-secondary small text-center mb-2'
                            v-text='t("menu.areaPackages.qrHint")'
                        />
                    </template>
                    <div class='d-flex flex-wrap gap-2 justify-content-center mt-2'>
                        <a
                            v-if='openQr.has(p.id)'
                            class='btn btn-sm btn-secondary'
                            data-test='link'
                            :href='qrs[p.id].url'
                            @click.prevent='copyLink(qrs[p.id].url)'
                            v-text='copied === p.id ? t("menu.areaPackages.copied") : t("menu.areaPackages.copyLink")'
                        />
                        <button
                            type='button'
                            class='btn btn-sm btn-primary'
                            data-test='offline'
                            :disabled='savingOffline.has(p.id)'
                            @click='saveOffline(p)'
                            v-text='savingOffline.has(p.id) ? t("menu.areaPackages.savingOffline") : t("menu.areaPackages.saveOffline")'
                        />
                    </div>
                </template>
            </div>

            <AreaPackageModal
                v-if='bounds'
                :bounds='bounds'
                @close='bounds = undefined'
                @created='created'
            />

            <TablerModal v-if='confirmDelete'>
                <div class='modal-status bg-red' />
                <div class='modal-header text-body'>
                    <div
                        class='modal-title'
                        v-text='t("menu.areaPackages.deleteTitle", { name: confirmDelete.name })'
                    />
                </div>
                <div
                    class='modal-body'
                    v-text='t("menu.areaPackages.deleteBody")'
                />
                <div class='modal-footer'>
                    <button
                        type='button'
                        class='btn btn-secondary'
                        @click='confirmDelete = undefined'
                        v-text='t("common.cancel")'
                    />
                    <button
                        type='button'
                        class='btn btn-danger'
                        data-test='delete-confirm'
                        @click='remove(confirmDelete)'
                        v-text='t("menu.areaPackages.delete")'
                    />
                </div>
            </TablerModal>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
// taklab: offline area packages - list, ATAK QR code, offline save, delete
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { bbox } from '@turf/bbox';
import type { Polygon } from 'geojson';
import { IconDownload, IconPlus, IconQrcode, IconTrash } from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerIconButton,
    TablerModal,
    TablerRefreshButton,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import AreaPackageModal from '../util/AreaPackageModal.vue';
import { std, stdurl } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import { DrawToolMode } from '../../../stores/modules/draw.ts';
import OverlayManager from '../../../base/overlay.ts';
import { downloadOfflineTiles, removeOfflineTiles } from '../../../stores/modules/offline-tiles.ts';
import type { AreaBounds } from '../../../base/taklab-area-features.ts';
import type { ProfileFile } from '../../../types.ts';

type AreaPackage = {
    id: string;
    name: string;
    token: string;
    status: 'Pending' | 'Running' | 'Success' | 'Fail';
    error: string | null;
    progress: number;
    size: number;
    assets: string[];
    created: string;
};

type QR = { url: string; uri: string; svg: string };

const POLL_MS = 3000;

const { t } = useI18n();
const mapStore = useMapStore();

const loading = ref(true);
const error = ref<Error | undefined>();
const packages = ref<AreaPackage[]>([]);
const qrs = reactive<Record<string, QR>>({});
const selecting = ref(false);
const bounds = ref<AreaBounds | undefined>();
const confirmDelete = ref<AreaPackage | undefined>();
const copied = ref<string | undefined>();
const savingOffline = reactive(new Set<string>());
const openQr = reactive(new Set<string>());

// Packages created in this session save themselves offline when they are ready
const autoOffline = new Set<string>();

let timer: ReturnType<typeof setTimeout> | undefined;

function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    return `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
}

function report(err: unknown): void {
    error.value = err instanceof Error ? err : new Error(String(err));
}

async function fetchList(): Promise<void> {
    clearTimeout(timer);
    loading.value = true;

    try {
        const list = await std('/api/profile/area-package') as { items: AreaPackage[] };
        packages.value = list.items;

        for (const p of list.items) {
            if (p.status !== 'Success') continue;

            if (!qrs[p.id]) qrs[p.id] = await std(`/api/profile/area-package/${p.id}/qr`) as QR;

            if (autoOffline.has(p.id)) {
                autoOffline.delete(p.id);
                await saveOffline(p);
            }
        }
    } catch (err) {
        report(err);
    } finally {
        loading.value = false;
    }

    if (packages.value.some((p) => p.status === 'Pending' || p.status === 'Running')) {
        timer = setTimeout(fetchList, POLL_MS);
    }
}

function selectArea(): void {
    selecting.value = true;
    mapStore.draw.start(DrawToolMode.RECTANGLE, {
        capture: (geometry: Polygon) => {
            selecting.value = false;
            const [w, s, e, n] = bbox(geometry);
            bounds.value = [w, s, e, n];
        },
    });
}

function toggleQr(id: string): void {
    if (openQr.has(id)) openQr.delete(id);
    else openQr.add(id);
}

async function created(pkg: unknown): Promise<void> {
    bounds.value = undefined;
    autoOffline.add((pkg as AreaPackage).id);
    await fetchList();
}

async function copyLink(url: string): Promise<void> {
    const id = Object.keys(qrs).find((key) => qrs[key].url === url);
    try {
        await navigator.clipboard.writeText(url);
        copied.value = id;
    } catch {
        // Clipboard unavailable (insecure context): the link is still in the href
    }
}

/** Download each layer of the package into offline storage and add it to the map */
async function saveOffline(p: AreaPackage): Promise<void> {
    if (savingOffline.has(p.id)) return;
    savingOffline.add(p.id);

    try {
        const files = await std('/api/profile/asset?limit=1000') as { items: ProfileFile[] };

        for (const id of p.assets) {
            const asset = files.items.find((f) => f.id === id);
            if (!asset) continue;

            await downloadOfflineTiles(asset);

            const url = stdurl(`/api/profile/asset/${encodeURIComponent(asset.id)}.pmtiles/tile`).toString();
            if (!OverlayManager.loaded.some((o) => o.url === url)) {
                await OverlayManager.createLoaded({
                    url,
                    name: asset.name,
                    mode: 'profile',
                    mode_id: asset.name,
                    type: 'raster',
                });
            }
        }
    } catch (err) {
        report(err);
    } finally {
        savingOffline.delete(p.id);
    }
}

async function remove(p: AreaPackage): Promise<void> {
    confirmDelete.value = undefined;

    try {
        await std(`/api/profile/area-package/${p.id}`, { method: 'DELETE' });
        for (const asset of p.assets) await removeOfflineTiles(asset);
        delete qrs[p.id];
    } catch (err) {
        report(err);
    }

    await fetchList();
}

onMounted(fetchList);

onUnmounted(() => {
    clearTimeout(timer);
});
</script>

<style scoped>
.area-package__qr {
    width: 100%;
    max-width: 240px;
    background: #fff;
    padding: 8px;
}
</style>
