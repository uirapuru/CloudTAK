<template>
    <MenuTemplate name='Overlay Explorer'>
        <template #buttons>
            <TablerRefreshButton
                :loading='loading'
                @click='fetchList'
            />
        </template>
        <template #default>
            <div class='d-flex flex-column gap-3 min-vh-100'>
                <div class='mt-2 d-flex align-items-center gap-3 flex-wrap'>
                    <TablerInput
                        v-model='paging.filter'
                        icon='search'
                        placeholder='Search overlays...'
                        class='flex-grow-1'
                    />
                </div>

                <div class='d-flex align-items-center gap-2 flex-wrap'>
                    <button
                        type='button'
                        class='btn btn-outline-secondary btn-sm'
                        :disabled='loading || bulkBusy'
                        @click='void addAll()'
                        v-text='bulkBusy ? "Pracuję…" : "Dodaj widoczne do nakładek"'
                    />
                    <button
                        type='button'
                        class='btn btn-outline-danger btn-sm'
                        :disabled='loading || bulkBusy'
                        @click='void removeAll()'
                        v-text='bulkBusy ? "Pracuję…" : "Usuń widoczne z nakładek"'
                    />
                </div>

                <p
                    v-if='removeNotice'
                    class='small mb-0 text-white-50'
                    v-text='removeNotice'
                />

                <div
                    v-if='paging.collection'
                    class='d-flex align-items-center gap-2'
                >
                    <PathBreadcrumb v-model:collection='paging.collection' />
                </div>

                <TablerLoading v-if='loading' />
                <template v-else>
                    <StandardItem
                        class='p-3 bg-info-subtle border border-info border-opacity-50'
                        @click='goToFiles'
                    >
                        <div class='d-flex justify-content-between gap-3 w-100'>
                            <div class='d-flex align-items-center gap-2 flex-grow-1 min-w-0'>
                                <IconUser
                                    class='flex-shrink-0 text-white-50'
                                    :size='24'
                                    stroke='1'
                                />
                                <div class='flex-grow-1 min-w-0'>
                                    <div class='d-flex align-items-center gap-2'>
                                        <span class='fw-semibold'>Your Files</span>
                                    </div>
                                    <p class='mb-0 small text-white-50'>
                                        Access overlays you have uploaded
                                    </p>
                                </div>
                            </div>
                            <div class='d-flex align-items-center gap-2 flex-wrap'>
                                <TablerIconButton
                                    title='Open Files'
                                    @click.stop.prevent='goToFiles'
                                >
                                    <IconFolder
                                        :size='20'
                                        stroke='1'
                                    />
                                </TablerIconButton>
                            </div>
                        </div>
                    </StandardItem>

                    <div
                        v-if='visibleIonItems.length && !paging.collection'
                        class='d-flex flex-column gap-2'
                    >
                        <div class='small text-white-50 text-uppercase'>
                            3D Buildings
                        </div>
                        <StandardItem
                            v-for='item in visibleIonItems'
                            :key='item.name'
                            class='p-3'
                            :class='[
                                ionOverlayNames.has(item.name) || loading ? "opacity-50 pe-none" : "",
                            ]'
                            :aria-disabled='loading || ionOverlayNames.has(item.name)'
                            @click='createIonOverlay(item)'
                        >
                            <div class='d-flex align-items-center gap-2'>
                                <IconBuildingSkyscraper
                                    :size='24'
                                    stroke='1'
                                />
                                <span class='fw-semibold'>{{ item.label }}</span>
                            </div>
                        </StandardItem>
                    </div>

                    <div
                        v-if='visibleLiveItems.length && !paging.collection'
                        class='d-flex flex-column gap-2'
                    >
                        <div class='small text-white-50 text-uppercase'>
                            Na żywo
                        </div>
                        <StandardItem
                            v-for='item in visibleLiveItems'
                            :key='item.name'
                            class='p-3'
                            :class='[
                                liveOverlayNames.has(item.name) || loading ? "opacity-50 pe-none" : "",
                            ]'
                            :aria-disabled='loading || liveOverlayNames.has(item.name)'
                            @click='createLiveOverlay(item)'
                        >
                            <div class='d-flex align-items-center gap-2'>
                                <IconBroadcast
                                    :size='24'
                                    stroke='1'
                                />
                                <span class='fw-semibold'>{{ item.label }}</span>
                                <span
                                    v-if='item.stale'
                                    class='small text-white-50'
                                >(nieaktualna)</span>
                            </div>
                        </StandardItem>
                    </div>

                    <div
                        v-if='list.items.length || list.collections.length'
                        class='d-flex flex-column gap-2'
                    >
                        <StandardItemFolder
                            v-for='collection in list.collections'
                            :key='collection.name'
                            :name='collection.name'
                            @click='setCollection(collection.name)'
                        />

                        <StandardItemBasemap
                            v-for='basemap in list.items'
                            :key='basemap.id'
                            :basemap='basemap'
                            :class='[
                                basemapExists(basemap) || loading ? "opacity-50 pe-none" : "",
                            ]'
                            :hover='!basemapExists(basemap) && !loading'
                            :aria-disabled='loading || basemapExists(basemap)'
                            @click='handleExplorerSelect(basemap)'
                        />
                    </div>

                    <TablerNone
                        v-else
                        label='No Overlays'
                        :create='false'
                    />
                </template>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Basemap, BasemapList } from '../../../types.ts';
import { server, stdurl, std } from '../../../std.ts';
import MenuTemplate from '../util/MenuTemplate.vue';
import {
    TablerNone,
    TablerInput,
    TablerLoading,
    TablerRefreshButton,
    TablerIconButton
} from '@tak-ps/vue-tabler';
import {
    IconUser,
    IconFolder,
    IconBuildingSkyscraper,
    IconBroadcast
} from '@tabler/icons-vue';
import StandardItem from '../util/StandardItem.vue';
import StandardItemBasemap from '../util/StandardItemBasemap.vue';
import StandardItemFolder from '../util/StandardItemFolder.vue';
import PathBreadcrumb from '../util/PathBreadcrumb.vue';
import OverlayManager from '../../../base/overlay.ts';
import { matchesFilter, overlayCountText, selectToAdd, selectToRemove, type ExplorerRef } from '../../../base/overlay-explorer-bulk.ts';
import type { Subscription } from 'dexie';
const router = useRouter();

const loading = ref(false);

const paging = ref({
    filter: '',
    collection: '',
    limit: 30,
    page: 0
});

const list = ref<BasemapList>({
    total: 0,
    collections: [],
    items: []
});

const overlayBasemapIds = ref<Set<string>>(new Set());
const ionOverlayNames = ref<Set<string>>(new Set());
const liveOverlayNames = ref<Set<string>>(new Set());
let overlaySubscription: Subscription | undefined;

onMounted(() => {
    overlaySubscription = OverlayManager.liveList().subscribe({
        next: (items) => {
            overlayBasemapIds.value = new Set(
                items
                    .filter((overlay) => overlay.mode === 'overlay' && overlay.mode_id)
                    .map((overlay) => String(overlay.mode_id))
            );
            ionOverlayNames.value = new Set(
                items
                    .filter((overlay) => overlay.mode === 'ion' && overlay.mode_id)
                    .map((overlay) => String(overlay.mode_id))
            );
            liveOverlayNames.value = new Set(
                items
                    .filter((overlay) => overlay.mode === 'live' && overlay.mode_id)
                    .map((overlay) => String(overlay.mode_id))
            );
        }
    });
});

onUnmounted(() => {
    overlaySubscription?.unsubscribe();
});

const ionItems = ref<Array<{ name: string; label: string }>>([]);
type LiveItem = { name: string; label: string; refresh: number; attribution: string; updated: string | null; stale: boolean };
const liveItems = ref<Array<LiveItem>>([]);

// 3D buildings and live layers obey the same search filter as the basemaps
const visibleIonItems = computed(() => ionItems.value.filter((i) => matchesFilter(i, paging.value.filter)));
const visibleLiveItems = computed(() => liveItems.value.filter((i) => matchesFilter(i, paging.value.filter)));

watch(
    () => [paging.value.filter, paging.value.collection, paging.value.limit, paging.value.page],
    async () => {
        await fetchList();
    }
);

onMounted(async () => {
    await Promise.all([fetchList(), fetchIon(), fetchLive()]);
});

function basemapExists(basemap: Basemap): boolean {
    return overlayBasemapIds.value.has(String(basemap.id));
}

async function handleExplorerSelect(basemap: Basemap) {
    if (loading.value) return;
    if (basemapExists(basemap)) return;
    await createOverlay(basemap);
}

function goToFiles() {
    router.push('/menu/files');
}

function setCollection(name: string): void {
    paging.value.collection = name;
    paging.value.filter = '';
    paging.value.page = 0;
}

async function addBasemap(overlay: Basemap): Promise<void> {
    await OverlayManager.createLoaded({
        url: String(stdurl(`/api/basemap/${overlay.id}/tiles`)),
        name: overlay.name,
        mode: 'overlay',
        mode_id: String(overlay.id),
        frequency: overlay.frequency,
        type: overlay.type,
        styles: overlay.styles
    });
}

async function createOverlay(overlay: Basemap) {
    loading.value = true;

    try {
        await addBasemap(overlay);
        router.push('/menu/overlays');
    } finally {
        loading.value = false;
    }
}

const bulkBusy = ref(false);
/** Outcome of the last "remove visible" - it deletes at once, without a confirmation step */
const removeNotice = ref('');

// Everything the Explorer visibly lists: the current page of basemaps, plus
// 3D buildings and live layers (filtered, only on the top level)
function explorerRefs(): ExplorerRef[] {
    const refs: ExplorerRef[] = list.value.items.map((b) => ({ mode: 'overlay' as const, modeId: String(b.id) }));
    if (!paging.value.collection) {
        refs.push(...visibleIonItems.value.map((i) => ({ mode: 'ion' as const, modeId: i.name })));
        refs.push(...visibleLiveItems.value.map((i) => ({ mode: 'live' as const, modeId: i.name })));
    }
    return refs;
}

// A changed list means the last outcome no longer describes what is shown
watch(() => [paging.value.filter, paging.value.collection, paging.value.page], () => {
    removeNotice.value = '';
});

async function addAll(): Promise<void> {
    if (loading.value || bulkBusy.value) return;
    bulkBusy.value = true;

    try {
        // Each new overlay lands on top of the ungrouped ones, so adding the
        // listed items last to first leaves them in the listed order
        const todo = selectToAdd(explorerRefs(), OverlayManager.loaded).reverse();
        for (const ref of todo) {
            try {
                if (ref.mode === 'overlay') {
                    const basemap = list.value.items.find((b) => String(b.id) === ref.modeId);
                    if (basemap) await addBasemap(basemap);
                } else if (ref.mode === 'live') {
                    const item = liveItems.value.find((i) => i.name === ref.modeId);
                    if (item) await addLive(item);
                } else {
                    const item = ionItems.value.find((i) => i.name === ref.modeId);
                    if (item) await addIon(item);
                }
            } catch (err) {
                console.error('Failed to add overlay', ref, err);
            }
        }
    } finally {
        bulkBusy.value = false;
    }
}

async function removeAll(): Promise<void> {
    if (loading.value || bulkBusy.value) return;
    bulkBusy.value = true;
    removeNotice.value = '';

    try {
        const todo = selectToRemove(explorerRefs(), [...OverlayManager.loaded]);
        if (!todo.length) {
            removeNotice.value = 'Żadna widoczna pozycja nie jest w nakładkach.';
            return;
        }

        let removed = 0;
        for (const overlay of todo) {
            try {
                await OverlayManager.deleteLoaded(overlay);
                removed += 1;
            } catch (err) {
                console.error('Failed to remove overlay', overlay.id, err);
            }
        }

        removeNotice.value = removed === todo.length
            ? `Usunięto z nakładek ${overlayCountText(removed)}.`
            : `Usunięto z nakładek ${overlayCountText(removed)} z ${todo.length}, reszta się nie udała.`;
    } finally {
        bulkBusy.value = false;
    }
}

async function fetchIon(): Promise<void> {
    try {
        const res = await std('/api/ion') as { items: Array<{ name: string; label: string }> };
        ionItems.value = res.items;
    } catch (err) {
        // 3D buildings are optional; the rest of the explorer must still work
        console.error('Failed to list Cesium ion assets', err);
        ionItems.value = [];
    }
}

async function fetchLive(): Promise<void> {
    try {
        const res = await std('/api/live') as { items: Array<LiveItem> };
        liveItems.value = res.items;
    } catch (err) {
        // Live layers are optional; the rest of the explorer must still work
        console.error('Failed to list live layers', err);
        liveItems.value = [];
    }
}

async function addLive(item: LiveItem): Promise<void> {
    await OverlayManager.createLoaded({
        url: `/api/live/${item.name}`,
        name: item.label,
        mode: 'live',
        mode_id: item.name,
        type: 'geojson',
        frequency: item.refresh,
        styles: []
    });
}

async function addIon(item: { name: string; label: string }): Promise<void> {
    await OverlayManager.createLoaded({
        url: `ion:${item.name}`,
        name: item.label,
        mode: 'ion',
        mode_id: item.name,
        type: '3dtiles',
        styles: []
    });
}

async function createLiveOverlay(item: LiveItem) {
    if (loading.value || liveOverlayNames.value.has(item.name)) return;
    loading.value = true;

    try {
        await addLive(item);

        router.push('/menu/overlays');
    } finally {
        loading.value = false;
    }
}

async function createIonOverlay(item: { name: string; label: string }) {
    if (loading.value || ionOverlayNames.value.has(item.name)) return;
    loading.value = true;

    try {
        await addIon(item);

        router.push('/menu/overlays');
    } finally {
        loading.value = false;
    }
}

async function fetchList(): Promise<void> {
    loading.value = true;

    try {
        const { data, error } = await server.GET('/api/basemap', {
            params: {
                query: {
                    filter: paging.value.filter,
                    collection: paging.value.collection || undefined,
                    overlay: true,
                    limit: paging.value.limit,
                    page: paging.value.page,
                    order: 'asc',
                    sort: 'name',
                    hidden: 'false'
                }
            }
        });

        if (error) throw new Error(error.message);
        if (!data) throw new Error('No data returned');

        list.value = data;
    } finally {
        loading.value = false;
    }
}
</script>
