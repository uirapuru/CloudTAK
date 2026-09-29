<template>
    <MenuTemplate name='Overlays'>
        <template #buttons>
            <TablerIconButton
                title='Dodaj grupę'
                @click='startCreateGroup'
            >
                <IconFolderPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerIconButton
                title='Add Overlay'
                @click='router.push("/menu/datas")'
            >
                <IconPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>

        <template #default>
            <div class='d-flex flex-column gap-3'>
                <div class='mt-2 d-flex align-items-center gap-3 flex-wrap'>
                    <TablerInput
                        v-model='overlayFilter'
                        placeholder='Search overlays...'
                        icon='search'
                        class='flex-grow-1'
                    />
                </div>

                <div class='d-flex align-items-center gap-2 flex-wrap'>
                    <label
                        v-if='toggleableCards.length'
                        class='form-check d-flex align-items-center gap-2 mb-0'
                    >
                        <input
                            type='checkbox'
                            class='form-check-input mt-0'
                            :checked='allState === "all"'
                            :indeterminate.prop='allState === "some"'
                            @change='void toggleAll($event)'
                        >
                        <span
                            class='form-check-label'
                            v-text='allState === "all" ? "Ukryj wszystkie" : "Pokaż wszystkie"'
                        />
                    </label>

                    <button
                        v-if='!creatingGroup'
                        type='button'
                        class='btn btn-sm btn-outline-light ms-auto d-inline-flex align-items-center gap-1'
                        @click='startCreateGroup'
                    >
                        <IconFolderPlus
                            :size='16'
                            stroke='1'
                        />
                        Dodaj grupę
                    </button>
                </div>

                <form
                    v-if='creatingGroup'
                    class='d-flex align-items-center gap-2'
                    @submit.prevent='void createGroup()'
                >
                    <input
                        ref='newGroupInput'
                        v-model='newGroupName'
                        type='text'
                        class='form-control form-control-sm'
                        placeholder='Nazwa grupy'
                        :maxlength='GROUP_NAME_MAX'
                        @keydown.esc.prevent='cancelCreateGroup'
                    >
                    <button
                        type='submit'
                        class='btn btn-sm btn-primary'
                        :disabled='!normalizeGroupName(newGroupName) || groupBusy'
                    >
                        Dodaj
                    </button>
                    <button
                        type='button'
                        class='btn btn-sm btn-secondary'
                        @click='cancelCreateGroup'
                    >
                        Anuluj
                    </button>
                </form>

                <p
                    v-if='groupError'
                    class='small mb-0 text-danger'
                    v-text='groupError'
                />

                <p
                    v-if='showDragHint'
                    class='small mb-0 text-white-50'
                >
                    Reordering available once you clear the search.
                </p>

                <TablerLoading
                    v-if='loading || !mapStore.isMapLoadedFully'
                    :desc='mapStore.isMapLoadedFully ? "Loading Overlays" : "Loading Map Overlays"'
                />

                <template v-else>
                    <div
                        v-if='sections.length'
                        ref='listsRoot'
                        class='d-flex flex-column gap-3'
                    >
                        <div
                            v-for='section in sections'
                            :key='section.id'
                            :class='{ "overlay-group rounded-3 p-2": section.group }'
                        >
                            <template v-if='section.group'>
                                <div class='d-flex align-items-center gap-2'>
                                    <TablerIconButton
                                        :title='section.group.collapsed ? "Rozwiń grupę" : "Zwiń grupę"'
                                        @click='void toggleCollapsed(section.group)'
                                    >
                                        <IconChevronRight
                                            v-if='section.group.collapsed'
                                            :size='20'
                                            stroke='1'
                                        />
                                        <IconChevronDown
                                            v-else
                                            :size='20'
                                            stroke='1'
                                        />
                                    </TablerIconButton>

                                    <input
                                        type='checkbox'
                                        class='form-check-input mt-0 flex-shrink-0'
                                        :title='section.state === "all" ? "Ukryj nakładki grupy" : "Pokaż nakładki grupy"'
                                        :checked='section.state === "all"'
                                        :indeterminate.prop='section.state === "some"'
                                        :disabled='!section.members.length'
                                        @change='void toggleGroup($event, section.members, section.state)'
                                    >

                                    <template v-if='renamingGroupId === section.group.id'>
                                        <input
                                            ref='renameInput'
                                            v-model='renameValue'
                                            type='text'
                                            class='form-control form-control-sm'
                                            :maxlength='GROUP_NAME_MAX'
                                            @keydown.enter.prevent='void saveRename(section.group)'
                                            @keydown.esc.prevent='cancelRename'
                                        >
                                        <TablerIconButton
                                            title='Zapisz nazwę'
                                            @click='void saveRename(section.group)'
                                        >
                                            <IconCheck
                                                :size='20'
                                                stroke='1'
                                            />
                                        </TablerIconButton>
                                        <TablerIconButton
                                            title='Anuluj'
                                            @click='cancelRename'
                                        >
                                            <IconX
                                                :size='20'
                                                stroke='1'
                                            />
                                        </TablerIconButton>
                                    </template>
                                    <template v-else>
                                        <span
                                            class='fw-semibold flex-grow-1 text-break'
                                            v-text='section.group.name'
                                        />
                                        <span
                                            class='badge rounded-pill text-bg-secondary'
                                            :title='`Nakładki w grupie: ${section.members.length}`'
                                            v-text='section.members.length'
                                        />
                                        <TablerIconButton
                                            title='Zmień nazwę grupy'
                                            @click='startRename(section.group)'
                                        >
                                            <IconPencil
                                                :size='20'
                                                stroke='1'
                                            />
                                        </TablerIconButton>
                                        <TablerIconButton
                                            title='Usuń grupę'
                                            @click='confirmDeleteGroupId = section.group.id'
                                        >
                                            <IconTrash
                                                :size='20'
                                                stroke='1'
                                            />
                                        </TablerIconButton>
                                    </template>
                                </div>

                                <div
                                    v-if='confirmDeleteGroupId === section.group.id'
                                    class='d-flex align-items-center gap-2 mt-2 p-2 rounded-2 bg-danger bg-opacity-25'
                                >
                                    <span class='small flex-grow-1'>
                                        Usunąć grupę? Jej nakładki zostaną na liście bez grupy.
                                    </span>
                                    <button
                                        type='button'
                                        class='btn btn-sm btn-danger'
                                        :disabled='groupBusy'
                                        @click='void deleteGroup(section.group)'
                                    >
                                        Usuń
                                    </button>
                                    <button
                                        type='button'
                                        class='btn btn-sm btn-secondary'
                                        @click='confirmDeleteGroupId = null'
                                    >
                                        Anuluj
                                    </button>
                                </div>
                            </template>

                            <div
                                v-show='!section.group || !section.group.collapsed'
                                class='overlay-list d-flex flex-column gap-3'
                                :class='{ "mt-2": section.group }'
                                :data-list-key='section.sortable ? listKeyAttr(section.key) : undefined'
                                :data-empty='section.emptyHint'
                            >
                                <StandardItem
                                    v-for='card in section.cards'
                                    :id='String(card.overlay.id)'
                                    :key='card.overlay.id'
                                    class='p-3 overlay-row'
                                    :class='{
                                        "overlay-pinned": OverlayManager.isPinned(card.overlay)
                                    }'
                                    :hover='card.overlay.id !== 0 && hasOverlayDetails(card.overlay)'
                                    @click='handleCardClick(card.overlay)'
                                >
                                    <div
                                        class='d-flex justify-content-between gap-3'
                                    >
                                        <div
                                            class='d-flex align-items-center gap-2 flex-grow-1 w-100 overflow-hidden'
                                            :aria-disabled='card.overlay.id === 0'
                                        >
                                            <span
                                                v-if='section.sortable && dragEnabled'
                                                class='drag-handle flex-shrink-0 align-self-stretch d-flex align-items-center cursor-move text-white-50'
                                                title='Przeciągnij, aby zmienić kolejność lub grupę'
                                                @click.stop
                                            >
                                                <IconGripVertical
                                                    :size='20'
                                                    stroke='1'
                                                />
                                            </span>
                                            <span
                                                v-if='card.overlay.type === "raster"'
                                                class='flex-shrink-0 text-white-50'
                                                title='Raster'
                                            >
                                                <IconMap
                                                    :size='20'
                                                    stroke='1'
                                                />
                                            </span>
                                            <span
                                                v-else-if='card.overlay.type === "raster-dem"'
                                                class='flex-shrink-0 text-white-50'
                                                title='Terrain'
                                            >
                                                <IconMap
                                                    :size='20'
                                                    stroke='1'
                                                />
                                            </span>
                                            <span
                                                v-else-if='card.overlay.type === "geojson" && card.overlay.mode === "mission"'
                                                class='flex-shrink-0 text-white-50'
                                                title='Data Sync'
                                            >
                                                <IconCloudPin
                                                    :size='20'
                                                    stroke='1'
                                                />
                                            </span>
                                            <span
                                                v-else-if='card.overlay.type === "3dtiles"'
                                                class='flex-shrink-0 text-white-50'
                                                title='3D Buildings'
                                            >
                                                <IconBuildingSkyscraper
                                                    :size='20'
                                                    stroke='1'
                                                />
                                            </span>
                                            <span
                                                v-else
                                                class='flex-shrink-0 text-white-50'
                                                title='Vector'
                                            >
                                                <IconVector
                                                    :size='20'
                                                    stroke='1'
                                                />
                                            </span>

                                            <div class='flex-grow-1 w-100 overflow-hidden'>
                                                <div class='d-flex align-items-center gap-2 w-100'>
                                                    <div class='d-flex align-items-center flex-grow-1 w-100'>
                                                        <a
                                                            v-if='card.overlay.mode === "mission"'
                                                            class='fw-semibold text-decoration-underline d-inline-flex align-items-center text-break'
                                                            @click.stop='router.push(`/menu/missions/${card.overlay.mode_id}`)'
                                                            v-text='card.overlay.name'
                                                        />
                                                        <span
                                                            v-else
                                                            class='fw-semibold d-inline-flex align-items-center flex-grow-1 text-break'
                                                            v-text='card.overlay.name'
                                                        />
                                                    </div>
                                                </div>
                                                <div
                                                    v-if='card.badges.length || card.offline'
                                                    class='d-flex flex-wrap align-items-center gap-2 mt-2'
                                                >
                                                    <span
                                                        v-for='badge in card.badges'
                                                        :key='`${card.overlay.id}-${badge.label}`'
                                                        class='badge rounded-pill'
                                                        :class='`text-bg-${badge.variant}`'
                                                    >
                                                        {{ badge.label }}
                                                    </span>
                                                    <OfflineBadge
                                                        v-if='card.offline'
                                                        title='Tiles are available offline on this device'
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div
                                            style='min-width: 100px;'
                                            class='d-flex flex-column align-items-end gap-2'
                                        >
                                            <span
                                                class='badge rounded-pill'
                                                :class='`text-bg-${card.status.variant}`'
                                                :title='card.status.tooltip || ""'
                                            >
                                                {{ card.status.label }}
                                            </span>

                                            <div class='d-flex align-items-center gap-2 flex-wrap justify-content-end w-100'>
                                                <TablerIconButton
                                                    v-if='card.overlay.hasBounds()'
                                                    title='Zoom To Overlay'
                                                    @click.stop.prevent='card.overlay.zoomTo()'
                                                >
                                                    <IconMaximize
                                                        :size='20'
                                                        stroke='1'
                                                    />
                                                </TablerIconButton>

                                                <TablerIconButton
                                                    v-if='card.visible'
                                                    title='Hide Layer'
                                                    @click.stop.prevent='void updateOverlay(card.overlay, { visible: !card.visible })'
                                                >
                                                    <IconEye
                                                        :size='20'
                                                        stroke='1'
                                                    />
                                                </TablerIconButton>

                                                <TablerIconButton
                                                    v-else
                                                    title='Show Layer'
                                                    @click.stop.prevent='void updateOverlay(card.overlay, { visible: !card.visible })'
                                                >
                                                    <IconEyeOff
                                                        :size='20'
                                                        stroke='1'
                                                    />
                                                </TablerIconButton>

                                                <TablerDelete
                                                    v-if='["mission", "data", "profile", "overlay"].includes(card.overlay.mode)'
                                                    :key='card.overlay.id'
                                                    title='Delete Overlay'
                                                    :size='20'
                                                    role='button'
                                                    tabindex='0'
                                                    displaytype='icon'
                                                    @delete='removeOverlay(card.overlay.id)'
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        v-if='opened.has(card.overlay.id) && hasOverlayDetails(card.overlay)'
                                        class='mt-3 p-3 rounded-3 border border-white border-opacity-10 bg-black bg-opacity-25'
                                        @click.stop
                                    >
                                        <div
                                            v-if='card.overlay.type === "raster" || card.overlay.type === "3dtiles"'
                                            class='mb-3'
                                        >
                                            <TablerRange
                                                :model-value='card.overlay.opacity'
                                                label='Opacity'
                                                :min='0'
                                                :max='1'
                                                :step='0.1'
                                                @update:model-value='void updateOverlay(card.overlay, { opacity: $event })'
                                            />
                                        </div>
                                        <TreeVector
                                            v-if='card.overlay.type === "vector"'
                                            :overlay='card.overlay'
                                        />
                                    </div>
                                </StandardItem>
                            </div>
                        </div>
                    </div>

                    <TablerNone
                        v-else
                        :label='hasSearchTerm ? "No overlays match your search" : "No overlays"'
                        :create='false'
                    />
                </template>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, watch, useTemplateRef, computed, nextTick, onMounted, onUpdated, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import type { Subscription } from 'dexie';
import MenuTemplate from '../util/MenuTemplate.vue';
import OfflineBadge from '../util/OfflineBadge.vue';
import {
    TablerDelete,
    TablerIconButton,
    TablerInput,
    TablerLoading,
    TablerNone,
    TablerRange
} from '@tak-ps/vue-tabler';
import TreeVector from './Overlays/TreeVector.vue';
import {
    IconGripVertical,
    IconCloudPin,
    IconBuildingSkyscraper,
    IconMaximize,
    IconVector,
    IconEyeOff,
    IconPencil,
    IconPlus,
    IconEye,
    IconMap,
    IconFolderPlus,
    IconChevronDown,
    IconChevronRight,
    IconTrash,
    IconCheck,
    IconX
} from '@tabler/icons-vue';
import { setAllVisible, visibilityState } from '../../../base/overlay-visibility.ts';
import type { VisibilityState } from '../../../base/overlay-visibility.ts';
import {
    GROUP_NAME_MAX,
    flattenLayout,
    moveInLayout,
    normalizeGroupName,
    partitionLayout,
    partitionOverlays,
    restoreNode
} from '../../../base/overlay-groups.ts';
import type { OverlayListKey } from '../../../base/overlay-groups.ts';
import OverlayGroupManager from '../../../base/overlay-group-manager.ts';
import StandardItem from '../util/StandardItem.vue';
import Sortable from 'sortablejs';
import type { SortableEvent } from 'sortablejs';
import type Overlay from '../../../../src/base/overlay-class.ts';
import type { DBOverlay } from '../../../../src/database.ts';
import type { ProfileOverlayGroup } from '../../../types.ts';
import OverlayManager from '../../../../src/base/overlay.ts';
import { useMapStore } from '../../../stores/map.ts';
import { profileAssetIdFromUrl } from '../../../utils/offline-tiles.ts';

type OverlayBadge = { label: string; variant: string };
type OverlayStatus = { label: string; variant: string; tooltip?: string };
type OverlayUpdate = Parameters<Overlay['update']>[0];
type OverlayCard = {
    overlay: Overlay;
    visible: boolean;
    groupId: number | null;
    status: OverlayStatus;
    badges: OverlayBadge[];
    offline: boolean;
};
type OverlaySection = {
    id: string;
    key: OverlayListKey;
    sortable: boolean;
    group: ProfileOverlayGroup | null;
    cards: OverlayCard[];
    /** Every overlay of the group, also those hidden by the search */
    members: OverlayCard[];
    state: VisibilityState;
    emptyHint?: string;
};

const router = useRouter();
const mapStore = useMapStore();

/** One Sortable per rendered list; they share a group so rows move between lists */
const sortables = new Map<HTMLElement, Sortable>();

const loading = ref(false);
const opened = ref<Set<number>>(new Set());
const overlayFilter = ref('');
const overlayRenderTick = ref(0);

const dbOverlays = ref<DBOverlay[]>([]);
const groups = ref<ProfileOverlayGroup[]>([]);

const creatingGroup = ref(false);
const newGroupName = ref('');
const renamingGroupId = ref<number | null>(null);
const renameValue = ref('');
const confirmDeleteGroupId = ref<number | null>(null);
const groupBusy = ref(false);
const groupError = ref('');

let listSubscription: Subscription | undefined;

const listsRoot = useTemplateRef<HTMLElement>('listsRoot');
const newGroupInput = useTemplateRef<HTMLInputElement>('newGroupInput');
const renameInput = useTemplateRef<HTMLInputElement[] | HTMLInputElement>('renameInput');

const hasSearchTerm = computed(() => overlayFilter.value.trim().length > 0);

/** Groups must be known before a drop, or the drop would ungroup the overlay */
const groupsLoaded = ref(false);
const dragEnabled = computed(() => groupsLoaded.value && !hasSearchTerm.value);

/** nextSibling of the row being dragged, recorded on drag start */
let dragNext: Node | null = null;

function overlayMatchesTerm(overlay: Overlay, term: string): boolean {
    return (
        (overlay.name ?? '').toLowerCase().includes(term)
        || (overlay.type ?? '').toLowerCase().includes(term)
        || (overlay.mode ?? '').toLowerCase().includes(term)
    );
}

/** Cards of every overlay, in menu order (bottom of the map stack first), ignoring the search */
const allCards = computed<OverlayCard[]>(() => {
    void overlayRenderTick.value;

    const records = new Map(dbOverlays.value.map((record) => [record.id, record]));
    const seen = new Set<number>();
    const cards: OverlayCard[] = [];

    const consider = (overlay: Overlay | undefined): void => {
        if (!overlay || seen.has(overlay.id)) return;
        seen.add(overlay.id);

        // The local record is written first on every change (also by other
        // devices through sync), so it is the reactive source of membership
        const record = records.get(overlay.id);

        cards.push({
            overlay,
            visible: overlay.visible,
            groupId: record ? record.group_id ?? null : overlay.group_id,
            status: resolveOverlayStatus(overlay),
            badges: getOverlayBadges(overlay),
            offline: isOfflineOverlay(overlay)
        });
    };

    for (const record of dbOverlays.value) {
        consider(OverlayManager.loadedFrom(record.id));
    }

    // Internal overlays (e.g. "Map Features") are never persisted, so merge them from the loaded set
    for (const overlay of OverlayManager.loaded) {
        consider(overlay);
    }

    // Menu order mirrors the map stacking order held by the manager
    return cards.sort((a, b) => OverlayManager.loaded.indexOf(a.overlay) - OverlayManager.loaded.indexOf(b.overlay));
});

const overlayCards = computed<OverlayCard[]>(() => {
    const term = overlayFilter.value.trim().toLowerCase();
    if (!term) return allCards.value;
    return allCards.value.filter((card) => overlayMatchesTerm(card.overlay, term));
});

/** Ordinary (not pinned) overlays split into the ungrouped list and the groups */
const partition = computed(() => partitionOverlays(
    allCards.value.filter((card) => !OverlayManager.isPinned(card.overlay)),
    groups.value,
    (card) => card.groupId
));

/**
 * Menu sections, top to bottom: the basemap, ungrouped overlays, the groups
 * and the internal overlays. The map stack follows the same order, so the
 * groups are drawn above the ungrouped overlays.
 */
const sections = computed<OverlaySection[]>(() => {
    const shown = new Set(overlayCards.value);
    const pinned = overlayCards.value.filter((card) => OverlayManager.isPinned(card.overlay));
    const result: OverlaySection[] = [];

    const staticSection = (id: string, cards: OverlayCard[]): void => {
        if (!cards.length) return;
        result.push({ id, key: null, sortable: false, group: null, cards, members: cards, state: visibilityState(cards) });
    };

    staticSection('pinned-bottom', pinned.filter((card) => card.overlay.mode === 'basemap'));

    const ungrouped = partition.value.ungrouped.filter((card) => shown.has(card));
    if (ungrouped.length || (!hasSearchTerm.value && partition.value.groups.length)) {
        result.push({
            id: 'ungrouped',
            key: null,
            sortable: true,
            group: null,
            cards: ungrouped,
            members: partition.value.ungrouped,
            state: visibilityState(partition.value.ungrouped),
            emptyHint: 'Przeciągnij tutaj nakładkę, aby wyjąć ją z grupy'
        });
    }

    for (const { group, items } of partition.value.groups) {
        const cards = items.filter((card) => shown.has(card));
        if (hasSearchTerm.value && !cards.length) continue;

        result.push({
            id: `group-${group.id}`,
            key: group.id,
            sortable: true,
            group,
            cards,
            members: items,
            state: visibilityState(items),
            emptyHint: 'Przeciągnij tutaj nakładki'
        });
    }

    staticSection('pinned-top', pinned.filter((card) => card.overlay.mode !== 'basemap'));

    return result;
});

const sortableCount = computed(() => allCards.value.filter((card) => !OverlayManager.isPinned(card.overlay)).length);

const showDragHint = computed(() => hasSearchTerm.value && sortableCount.value > 1);

function listKeyAttr(key: OverlayListKey): string {
    return key === null ? 'ungrouped' : String(key);
}

function parseListKey(attr: string | undefined): OverlayListKey | undefined {
    if (attr === 'ungrouped') return null;
    const id = Number(attr);
    return Number.isInteger(id) ? id : undefined;
}

function subscribeList(): void {
    listSubscription?.unsubscribe();
    loading.value = true;

    listSubscription = OverlayManager.liveList({ localFirst: true }).subscribe({
        next: (items) => {
            dbOverlays.value = items as DBOverlay[];
            loading.value = false;
        },
        error: (err: unknown) => {
            console.error('Failed to load overlays:', err);
            dbOverlays.value = [];
            loading.value = false;
        }
    });
}

async function loadGroups(): Promise<void> {
    // Show the local copy first so the grouping survives an offline start
    groups.value = await OverlayGroupManager.cached();
    groups.value = await OverlayGroupManager.list();
    groupsLoaded.value = true;
}

onMounted(() => {
    subscribeList();
    void loadGroups();
    syncSortables();
});

onUpdated(() => {
    syncSortables();
});

watch(dragEnabled, async () => {
    await nextTick();
    syncSortables();
});

/** Attach a Sortable to every rendered list and drop those whose list is gone */
function syncSortables(): void {
    const root = listsRoot.value;
    const lists = root ? Array.from(root.querySelectorAll<HTMLElement>('[data-list-key]')) : [];

    for (const [el, sortable] of sortables) {
        if (!lists.includes(el)) {
            sortable.destroy();
            sortables.delete(el);
        }
    }

    for (const el of lists) {
        let sortable = sortables.get(el);
        if (!sortable) {
            sortable = new Sortable(el, {
                group: 'overlays',
                sort: true,
                handle: '.drag-handle',
                draggable: '.overlay-row',
                dataIdAttr: 'id',
                onStart: (ev) => { dragNext = ev.item.nextSibling; },
                onEnd: (ev) => void handleDrop(ev)
            });
            sortables.set(el, sortable);
        }

        sortable.option('disabled', !dragEnabled.value);
    }
}

onBeforeUnmount(() => {
    listSubscription?.unsubscribe();
    listSubscription = undefined;

    for (const sortable of sortables.values()) sortable.destroy();
    sortables.clear();
});

function toggleOverlay(id: number) {
    if (opened.value.has(id)) {
        opened.value.delete(id);
    } else {
        opened.value.add(id);
    }
}

function handleCardClick(overlay: Overlay) {
    if (overlay.id === 0) return;
    if (!hasOverlayDetails(overlay)) return;
    toggleOverlay(overlay.id);
}

/** Whether an overlay has an expandable details panel. Mission overlays are managed from MenuMission and are not expandable here. */
function hasOverlayDetails(overlay: Overlay): boolean {
    return overlay.type === 'raster'
        || overlay.type === '3dtiles'
        || overlay.type === 'vector';
}

function resolveOverlayStatus(overlay: Overlay): OverlayStatus {
    if (!overlay.healthy()) {
        return {
            label: 'Issue',
            variant: 'danger',
            tooltip: overlay._error?.message ?? 'Unknown error'
        };
    }

    if (overlay.loading) {
        return {
            label: 'Pending',
            variant: 'warning',
            tooltip: 'Overlay is still loading data from the server.'
        };
    }

    if (!overlay.styles?.length) {
        return {
            label: 'Pending',
            variant: 'warning',
            tooltip: 'Overlay does not contain any styles yet.'
        };
    }

    return {
        label: 'Ready',
        variant: 'success'
    };
}

function isOfflineOverlay(overlay: Overlay): boolean {
    const assetId = profileAssetIdFromUrl(overlay.url);
    return !!assetId && mapStore.offlineTiles.has(assetId);
}

function getOverlayBadges(overlay: Overlay): OverlayBadge[] {
    const badges: OverlayBadge[] = [];
    const seen = new Set<string>();

    const addBadge = (badge: OverlayBadge) => {
        if (seen.has(badge.label)) return;
        seen.add(badge.label);
        badges.push(badge);
    };

    if (overlay.mode === 'mission') {
        addBadge({ label: 'Mission', variant: 'primary' });
    } else if (overlay.mode === 'data') {
        addBadge({ label: 'Data', variant: 'info' });
    } else if (overlay.mode === 'profile') {
        addBadge({ label: 'Profile', variant: 'info' });
    }

    if (overlay.type === 'raster') {
        addBadge({ label: 'Raster', variant: 'secondary' });
    } else if (overlay.type === 'raster-dem') {
        addBadge({ label: 'Terrain', variant: 'secondary' });
    } else if (overlay.type === 'vector') {
        addBadge({ label: 'Vector', variant: 'secondary' });
    } else if (overlay.type === 'geojson') {
        addBadge({ label: 'GeoJSON', variant: 'secondary' });
    } else if (overlay.type === '3dtiles') {
        addBadge({ label: '3D', variant: 'secondary' });
    }

    if (!overlay.visible) {
        addBadge({ label: 'Hidden', variant: 'dark' });
    }

    return badges;
}

/**
 * A row was dropped. Sortable moved the DOM node; it is put back so Vue
 * stays the only owner of the rows, and the new order and group are applied
 * to the data instead - Vue then renders the row in its new place.
 */
async function handleDrop(ev: SortableEvent): Promise<void> {
    const { item, from, to, oldIndex, newIndex } = ev;

    restoreNode(item, from, dragNext);
    dragNext = null;

    if (oldIndex === undefined || newIndex === undefined) return;

    const id = Number(item.getAttribute('id'));
    const target = parseListKey(to.dataset.listKey);
    if (!Number.isFinite(id) || target === undefined) return;
    if (from === to && oldIndex === newIndex) return;

    // An overlay in a group this client does not know (yet) is listed as
    // ungrouped - reordering it there must not drop its membership
    const current = allCards.value.find((card) => card.overlay.id === id)?.groupId ?? null;
    const unknownGroup = current !== null && !groups.value.some((group) => group.id === current);
    const groupId = target === null && unknownGroup ? undefined : target;

    try {
        const layout = moveInLayout(partitionLayout(partition.value, (card) => card.overlay.id), id, target, newIndex);

        const reorder = OverlayManager.reorderLoaded(flattenLayout(layout), id, { groupId });

        // Show the new membership right away - the local record follows
        if (groupId !== undefined) {
            dbOverlays.value = dbOverlays.value.map((record) => record.id === id ? { ...record, group_id: groupId } : record);
        }
        overlayRenderTick.value += 1;

        await reorder;
    } catch (err) {
        console.error('Failed to sync overlay order:', err);
        groupError.value = errorText('Nie udało się przenieść nakładki', err);
        // The group may be gone on another device - reload groups and overlays from the server
        void loadGroups();
        OverlayManager.sync().catch((syncErr: unknown) => console.error('Failed to resync overlays:', syncErr));
    } finally {
        overlayRenderTick.value += 1;
    }
}

async function updateOverlay(overlay: Overlay, body: OverlayUpdate): Promise<void> {
    const update = overlay.update(body);
    overlayRenderTick.value += 1;

    try {
        await update;
    } catch (err) {
        console.error('Failed to sync overlay update:', err);
    } finally {
        overlayRenderTick.value += 1;
    }
}

/** Show/hide all leaves the basemap and "Map Features" alone */
const toggleableCards = computed(() => overlayCards.value.filter((card) => !OverlayManager.isPinned(card.overlay)));

const allState = computed(() => visibilityState(toggleableCards.value));

/** Keep a checkbox in line with the overlays even when every update failed and Vue sees no change */
function syncCheckbox(ev: Event, cards: OverlayCard[]): void {
    const el = ev.target as HTMLInputElement | null;
    if (!el) return;
    const state = visibilityState(cards.map((card) => ({ visible: card.overlay.visible })));
    el.checked = state === 'all';
    el.indeterminate = state === 'some';
}

async function toggleAll(ev: Event): Promise<void> {
    const cards = toggleableCards.value;
    await setAllVisible(cards, allState.value !== 'all', (card, body) => updateOverlay(card.overlay, body));
    syncCheckbox(ev, cards);
}

async function toggleGroup(ev: Event, members: OverlayCard[], state: VisibilityState): Promise<void> {
    await setAllVisible(members, state !== 'all', (card, body) => updateOverlay(card.overlay, body));
    syncCheckbox(ev, members);
}

async function removeOverlay(id: number) {
    try {
        await OverlayManager.deleteLoaded(id);
    } catch (err) {
        console.error('Failed to sync overlay delete:', err);
    }
}

function errorText(prefix: string, err: unknown): string {
    return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}

async function startCreateGroup(): Promise<void> {
    groupError.value = '';
    creatingGroup.value = true;
    await nextTick();
    newGroupInput.value?.focus();
}

function cancelCreateGroup(): void {
    creatingGroup.value = false;
    newGroupName.value = '';
}

async function createGroup(): Promise<void> {
    const name = normalizeGroupName(newGroupName.value);
    if (!name || groupBusy.value) return;

    groupBusy.value = true;
    groupError.value = '';

    try {
        const group = await OverlayGroupManager.create(name);
        groups.value = [...groups.value, group];
        cancelCreateGroup();
    } catch (err) {
        groupError.value = errorText('Nie udało się dodać grupy', err);
    } finally {
        groupBusy.value = false;
    }
}

async function startRename(group: ProfileOverlayGroup): Promise<void> {
    groupError.value = '';
    confirmDeleteGroupId.value = null;
    renamingGroupId.value = group.id;
    renameValue.value = group.name;
    await nextTick();
    const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
    input?.focus();
    input?.select();
}

function cancelRename(): void {
    renamingGroupId.value = null;
    renameValue.value = '';
}

async function saveRename(group: ProfileOverlayGroup): Promise<void> {
    const name = normalizeGroupName(renameValue.value);
    if (!name) {
        groupError.value = `Nazwa grupy musi mieć od 1 do ${GROUP_NAME_MAX} znaków.`;
        return;
    }

    if (name === group.name) {
        cancelRename();
        return;
    }

    try {
        const updated = await OverlayGroupManager.update(group.id, { name });
        groups.value = groups.value.map((current) => current.id === group.id ? updated : current);
        groupError.value = '';
        cancelRename();
    } catch (err) {
        groupError.value = errorText('Nie udało się zmienić nazwy grupy', err);
    }
}

async function toggleCollapsed(group: ProfileOverlayGroup): Promise<void> {
    const collapsed = !group.collapsed;
    groups.value = groups.value.map((current) => current.id === group.id ? { ...current, collapsed } : current);

    try {
        await OverlayGroupManager.update(group.id, { collapsed });
    } catch (err) {
        console.error('Failed to sync overlay group collapse:', err);
    }
}

async function deleteGroup(group: ProfileOverlayGroup): Promise<void> {
    if (groupBusy.value) return;

    groupBusy.value = true;
    groupError.value = '';

    try {
        await OverlayGroupManager.delete(group.id);
        groups.value = groups.value.filter((current) => current.id !== group.id);
        confirmDeleteGroupId.value = null;
    } catch (err) {
        groupError.value = errorText('Nie udało się usunąć grupy', err);
    } finally {
        groupBusy.value = false;
    }
}
</script>

<style scoped>
.overlay-group {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.15);
}

.overlay-list[data-list-key] {
    min-height: 2.5rem;
}

.overlay-list[data-list-key]:empty::before {
    content: attr(data-empty);
    display: block;
    padding: 0.5rem;
    border: 1px dashed rgba(255, 255, 255, 0.25);
    border-radius: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
}

.drag-handle {
    touch-action: none;
}
</style>
