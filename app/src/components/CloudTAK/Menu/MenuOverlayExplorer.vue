<template>
    <MenuTemplate name='Overlay Explorer'>
        <template #buttons>
            <TablerRefreshButton
                :loading='loading'
                @click='void fetchList({ fresh: true })'
            />
        </template>
        <template #default>
            <div class='d-flex flex-column gap-3 min-vh-100'>
                <div class='mt-2 d-flex align-items-center gap-3 flex-wrap'>
                    <TablerInput
                        v-model='filter'
                        icon='search'
                        placeholder='Search overlays...'
                        class='flex-grow-1'
                    />
                </div>

                <div class='d-flex align-items-center gap-2 flex-wrap'>
                    <button
                        type='button'
                        class='btn btn-outline-secondary btn-sm'
                        :title='bulkHint'
                        :disabled='loading || bulkBusy'
                        @click='void addAll()'
                        v-text='bulkBusy ? "Pracuję…" : "Dodaj widoczne do nakładek"'
                    />
                    <button
                        type='button'
                        class='btn btn-outline-danger btn-sm'
                        :title='bulkHint'
                        :disabled='loading || bulkBusy'
                        @click='void removeAll()'
                        v-text='bulkBusy ? "Pracuję…" : "Usuń widoczne z nakładek"'
                    />
                </div>

                <p
                    v-if='notice'
                    class='small mb-0 text-white-50'
                    v-text='notice'
                />

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
                        v-for='section in sections'
                        :key='section.category'
                        class='explorer-section d-flex flex-column gap-2'
                        :data-category='section.category'
                    >
                        <button
                            type='button'
                            class='explorer-section-header btn btn-link text-reset text-decoration-none p-0 d-flex align-items-center gap-2'
                            :aria-expanded='isOpen(section.category)'
                            @click='void toggleSection(section.category)'
                        >
                            <IconChevronDown
                                v-if='isOpen(section.category)'
                                :size='20'
                                stroke='1'
                            />
                            <IconChevronRight
                                v-else
                                :size='20'
                                stroke='1'
                            />
                            <IconStarFilled
                                v-if='section.category === FAVORITES'
                                class='text-warning'
                                :size='16'
                            />
                            <span
                                class='small text-uppercase fw-semibold flex-grow-1 text-start'
                                v-text='section.category'
                            />
                            <span
                                class='badge rounded-pill text-bg-secondary'
                                :title='`Warstwy w sekcji: ${section.entries.length}`'
                                v-text='section.entries.length'
                            />
                        </button>

                        <!-- v-show on a wrapper: d-flex is display:flex !important and would beat display:none -->
                        <div v-show='isOpen(section.category)'>
                            <div class='d-flex flex-column gap-2'>
                                <p
                                    v-if='section.category === FAVORITES && !section.entries.length'
                                    class='small mb-0 text-white-50'
                                >
                                    Kliknij gwiazdkę przy warstwie, aby mieć ją tutaj pod ręką.
                                </p>

                                <template
                                    v-for='entry in section.entries'
                                    :key='`${section.category}-${entryKey(entry)}`'
                                >
                                    <StandardItemBasemap
                                        v-if='entry.mode === "overlay" && basemapOf(entry)'
                                        :basemap='basemapOf(entry) as Basemap'
                                        class='explorer-entry'
                                        :class='{ "opacity-50": isAdded(entry) || loading }'
                                        :hover='!isAdded(entry) && !loading'
                                        :aria-disabled='loading || isAdded(entry)'
                                        :data-key='entryKey(entry)'
                                        @click='void selectEntry(entry)'
                                    >
                                        <template #actions>
                                            <FavoriteStar
                                                :active='favoriteKeys.has(entryKey(entry))'
                                                @toggle='void toggleFavorite(entryKey(entry))'
                                            />
                                        </template>
                                    </StandardItemBasemap>

                                    <StandardItem
                                        v-else-if='entry.mode !== "overlay"'
                                        class='explorer-entry p-3'
                                        :class='{ "opacity-50": isAdded(entry) || loading }'
                                        :hover='!isAdded(entry) && !loading'
                                        :aria-disabled='loading || isAdded(entry)'
                                        :data-key='entryKey(entry)'
                                        @click='void selectEntry(entry)'
                                    >
                                        <div class='d-flex align-items-center gap-2'>
                                            <IconBroadcast
                                                v-if='entry.mode === "live"'
                                                :size='24'
                                                stroke='1'
                                            />
                                            <IconBuildingSkyscraper
                                                v-else
                                                :size='24'
                                                stroke='1'
                                            />
                                            <span
                                                class='fw-semibold flex-grow-1'
                                                v-text='entry.label'
                                            />
                                            <span
                                                v-if='entry.mode === "live" && liveOf(entry)?.stale'
                                                class='small text-white-50'
                                            >(nieaktualna)</span>
                                            <FavoriteStar
                                                :active='favoriteKeys.has(entryKey(entry))'
                                                @toggle='void toggleFavorite(entryKey(entry))'
                                            />
                                        </div>
                                    </StandardItem>
                                </template>
                            </div>
                        </div>
                    </div>

                    <TablerNone
                        v-if='!entries.length || (filter.trim() && !sections.length)'
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
import type { Basemap } from '../../../types.ts';
import { stdurl } from '../../../std.ts';
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
    IconBroadcast,
    IconChevronDown,
    IconChevronRight,
    IconStarFilled
} from '@tabler/icons-vue';
import StandardItem from '../util/StandardItem.vue';
import StandardItemBasemap from '../util/StandardItemBasemap.vue';
import FavoriteStar from './Overlays/FavoriteStar.vue';
import OverlayManager from '../../../base/overlay.ts';
import type Overlay from '../../../base/overlay-class.ts';
import { db } from '../../../database.ts';
import { overlayCountText, selectToAdd, selectToRemove, type ExplorerRef } from '../../../base/overlay-explorer-bulk.ts';
import {
    BUILDINGS_3D,
    FAVORITES,
    explorerSections,
    normalizeCategory,
    type ExplorerEntry
} from '../../../base/overlay-categories.ts';
import { loadCatalog, type ExplorerCatalog, type IonItem, type LiveItem } from '../../../base/overlay-catalog.ts';
import OverlayFavoriteManager, { favoriteKeys as favoriteStore } from '../../../base/overlay-favorite-manager.ts';
import CategoryPlacer, { syncCatalogNames } from '../../../base/overlay-category-manager.ts';
import type { Subscription } from 'dexie';

const router = useRouter();

/** Section collapse state of this device */
const COLLAPSED_KV_KEY = 'overlay-explorer-collapsed';

const loading = ref(false);
const filter = ref('');

const catalog = ref<ExplorerCatalog>({ basemaps: [], live: [], ion: [] });

/** `${mode}:${mode_id}` of the catalog overlays already in the profile */
const addedKeys = ref<Set<string>>(new Set());
let overlaySubscription: Subscription | undefined;

const favoriteKeys = computed(() => favoriteStore.value);
const collapsed = ref<Set<string>>(new Set());

onMounted(() => {
    overlaySubscription = OverlayManager.liveList().subscribe({
        next: (items) => {
            addedKeys.value = new Set(
                items
                    .filter((overlay) => ['overlay', 'live', 'ion'].includes(overlay.mode) && overlay.mode_id)
                    .map((overlay) => `${overlay.mode}:${overlay.mode_id}`)
            );
        }
    });
});

onUnmounted(() => {
    overlaySubscription?.unsubscribe();
});

onMounted(async () => {
    await Promise.all([
        fetchList(),
        loadCollapsed(),
        OverlayFavoriteManager.load()
    ]);
});

/** Every item of the catalog with its category */
const entries = computed<ExplorerEntry[]>(() => [
    ...catalog.value.basemaps.map((basemap) => ({
        mode: 'overlay' as const,
        modeId: String(basemap.id),
        name: basemap.name,
        label: basemap.name,
        category: normalizeCategory(basemap.collection)
    })),
    ...catalog.value.live.map((item) => ({
        mode: 'live' as const,
        modeId: item.name,
        name: item.name,
        label: item.label,
        category: normalizeCategory(item.category)
    })),
    ...catalog.value.ion.map((item) => ({
        mode: 'ion' as const,
        modeId: item.name,
        name: item.name,
        label: item.label,
        category: BUILDINGS_3D
    }))
]);

const sections = computed(() => explorerSections(entries.value, new Set(favoriteKeys.value), filter.value));

const searching = computed(() => filter.value.trim().length > 0);

/** While searching every section with a match is open, so the matches are seen */
function isOpen(category: string): boolean {
    return searching.value || !collapsed.value.has(category);
}

const bulkHint = 'Działa na warstwach w rozwiniętych sekcjach, a podczas wyszukiwania na wszystkich wynikach.';

function entryKey(entry: ExplorerEntry): string {
    return `${entry.mode}:${entry.modeId}`;
}

function basemapOf(entry: ExplorerEntry): Basemap | undefined {
    return catalog.value.basemaps.find((basemap) => String(basemap.id) === entry.modeId);
}

function liveOf(entry: ExplorerEntry): LiveItem | undefined {
    return catalog.value.live.find((item) => item.name === entry.modeId);
}

function ionOf(entry: ExplorerEntry): IonItem | undefined {
    return catalog.value.ion.find((item) => item.name === entry.modeId);
}

function isAdded(entry: ExplorerEntry): boolean {
    return addedKeys.value.has(entryKey(entry));
}

function goToFiles() {
    router.push('/menu/files');
}

async function loadCollapsed(): Promise<void> {
    try {
        const entry = await db.kv.get(COLLAPSED_KV_KEY);
        collapsed.value = new Set(entry ? JSON.parse(entry.value) as string[] : []);
    } catch (err) {
        console.error('Failed to read collapsed explorer sections:', err);
    }
}

async function toggleSection(category: string): Promise<void> {
    // During a search the sections are forced open - the stored state is left alone
    if (searching.value) return;

    const next = new Set(collapsed.value);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    collapsed.value = next;

    try {
        await db.kv.put({ key: COLLAPSED_KV_KEY, value: JSON.stringify([...next]) });
    } catch (err) {
        console.error('Failed to store collapsed explorer sections:', err);
    }
}

const notice = ref('');

async function toggleFavorite(key: string): Promise<void> {
    try {
        await OverlayFavoriteManager.toggle(key);
    } catch (err) {
        notice.value = `Nie udało się zmienić ulubionych: ${err instanceof Error ? err.message : String(err)}`;
    }
}

/** Add one catalog item to the overlays - it goes on top of its category group */
async function addEntry(entry: ExplorerEntry, placer: CategoryPlacer): Promise<void> {
    let overlay: Overlay | undefined;

    if (entry.mode === 'overlay') {
        const basemap = basemapOf(entry);
        if (basemap) overlay = await addBasemap(basemap);
    } else if (entry.mode === 'live') {
        const item = liveOf(entry);
        if (item) overlay = await addLive(item);
    } else {
        const item = ionOf(entry);
        if (item) overlay = await addIon(item);
    }

    if (!overlay) return;

    try {
        await placer.place([{ id: overlay.id, category: entry.category }], 'top');
    } catch (err) {
        // The overlay exists - it stays without a group
        console.error('Failed to put overlay into its category group', overlay.id, err);
    }
}

async function selectEntry(entry: ExplorerEntry): Promise<void> {
    if (loading.value || isAdded(entry)) return;
    loading.value = true;

    try {
        await addEntry(entry, await CategoryPlacer.load());
        router.push('/menu/overlays');
    } finally {
        loading.value = false;
    }
}

async function addBasemap(overlay: Basemap): Promise<Overlay> {
    return await OverlayManager.createLoaded({
        url: String(stdurl(`/api/basemap/${overlay.id}/tiles`)),
        name: overlay.name,
        mode: 'overlay',
        mode_id: String(overlay.id),
        frequency: overlay.frequency,
        type: overlay.type,
        styles: overlay.styles
    });
}

async function addLive(item: LiveItem): Promise<Overlay> {
    return await OverlayManager.createLoaded({
        url: `/api/live/${item.name}`,
        name: item.label,
        mode: 'live',
        mode_id: item.name,
        type: 'geojson',
        frequency: item.refresh,
        styles: []
    });
}

async function addIon(item: IonItem): Promise<Overlay> {
    return await OverlayManager.createLoaded({
        url: `ion:${item.name}`,
        name: item.label,
        mode: 'ion',
        mode_id: item.name,
        type: '3dtiles',
        styles: []
    });
}

const bulkBusy = ref(false);

/**
 * What "Dodaj/Usuń widoczne" works on: the rows on screen - the entries of
 * the open sections (while searching every section with a match is open).
 * A favorite listed twice (in "Ulubione" and its category) counts once.
 */
function visibleEntries(): ExplorerEntry[] {
    const seen = new Set<string>();
    const out: ExplorerEntry[] = [];

    for (const section of sections.value) {
        if (!isOpen(section.category)) continue;
        for (const entry of section.entries) {
            const key = entryKey(entry);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(entry);
        }
    }

    return out;
}

function explorerRefs(list: ExplorerEntry[]): ExplorerRef[] {
    return list.map((entry) => ({ mode: entry.mode, modeId: entry.modeId }));
}

// A changed list means the last outcome no longer describes what is shown
watch(filter, () => {
    notice.value = '';
});

async function addAll(): Promise<void> {
    if (loading.value || bulkBusy.value) return;
    bulkBusy.value = true;
    notice.value = '';

    try {
        const visible = visibleEntries();
        const byKey = new Map(visible.map((entry) => [entryKey(entry), entry]));

        // Each new overlay lands on top of its group, so adding the listed
        // items last to first leaves them in the listed order
        const todo = selectToAdd(explorerRefs(visible), OverlayManager.loaded).reverse();
        if (!todo.length) {
            notice.value = 'Wszystkie widoczne warstwy są już w nakładkach.';
            return;
        }

        const placer = await CategoryPlacer.load();
        let added = 0;
        for (const ref of todo) {
            const entry = byKey.get(`${ref.mode}:${ref.modeId}`);
            if (!entry) continue;

            try {
                await addEntry(entry, placer);
                added += 1;
            } catch (err) {
                console.error('Failed to add overlay', ref, err);
            }
        }

        notice.value = added === todo.length
            ? `Dodano do nakładek ${overlayCountText(added)}.`
            : `Dodano do nakładek ${overlayCountText(added)} z ${todo.length}, reszta się nie udała.`;
    } finally {
        bulkBusy.value = false;
    }
}

async function removeAll(): Promise<void> {
    if (loading.value || bulkBusy.value) return;
    bulkBusy.value = true;
    notice.value = '';

    try {
        const todo = selectToRemove(explorerRefs(visibleEntries()), [...OverlayManager.loaded]);
        if (!todo.length) {
            notice.value = 'Żadna widoczna pozycja nie jest w nakładkach.';
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

        notice.value = removed === todo.length
            ? `Usunięto z nakładek ${overlayCountText(removed)}.`
            : `Usunięto z nakładek ${overlayCountText(removed)} z ${todo.length}, reszta się nie udała.`;
    } finally {
        bulkBusy.value = false;
    }
}

async function fetchList(opts: { fresh?: boolean } = {}): Promise<void> {
    loading.value = true;

    try {
        catalog.value = await loadCatalog(opts);
    } catch (err) {
        console.error('Failed to load the overlay catalog', err);
        notice.value = `Nie udało się wczytać katalogu warstw: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
        loading.value = false;
    }

    // Overlays added earlier keep the name they had then - follow the catalog quietly
    syncCatalogNames(catalog.value).catch((err: unknown) => console.error('Failed to sync overlay names', err));
}
</script>
