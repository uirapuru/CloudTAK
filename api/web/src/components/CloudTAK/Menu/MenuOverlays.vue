<template>
    <MenuTemplate name='Overlays'>
        <template #buttons>
            <TablerIconButton
                :class='{
                    "pe-none": !isDraggable && !canEditOrder,
                    "opacity-50": !isDraggable && !canEditOrder
                }'
                :title='reorderButtonTitle'
                @click='handleReorderToggle'
            >
                <IconPencil
                    v-if='!isDraggable'
                    :size='32'
                    stroke='1'
                />
                <IconPencilCheck
                    v-else
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerIconButton
                title='Create Group'
                @click='startCreateGroup'
            >
                <IconFolderPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerIconButton
                v-if='!isDraggable'
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

                <form
                    v-if='creatingGroup'
                    class='d-flex align-items-center gap-2'
                    @submit.prevent='void createGroup()'
                >
                    <input
                        ref='newGroupInput'
                        v-model='newGroupName'
                        type='text'
                        class='form-control'
                        placeholder='Group Name'
                        :maxlength='GROUP_NAME_MAX'
                        @keydown.esc.prevent='cancelCreateGroup'
                    >
                    <button
                        type='submit'
                        class='btn btn-primary'
                        :disabled='!normalizeGroupName(newGroupName) || groupBusy'
                    >
                        Create
                    </button>
                    <button
                        type='button'
                        class='btn btn-secondary'
                        @click='cancelCreateGroup'
                    >
                        Cancel
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
                    {{ dragHintCopy }}
                </p>

                <TablerLoading
                    v-if='loading || !mapStore.isMapLoadedFully'
                    :desc='mapStore.isMapLoadedFully ? "Loading Overlays" : "Loading Map Overlays"'
                />

                <template v-else>
                    <div
                        v-if='hasRows'
                        class='d-flex flex-column gap-3'
                    >
                        <div
                            v-if='basemapCards.length'
                            class='overlay-list d-flex flex-column gap-3'
                        >
                            <OverlayRow
                                v-for='card in basemapCards'
                                :key='card.overlay.id'
                                :card='card'
                                :editing='isDraggable'
                                :opened='opened.has(card.overlay.id)'
                                @toggle='handleCardClick(card.overlay)'
                                @update='void updateOverlay(card.overlay, $event)'
                                @remove='void removeOverlay(card.overlay.id)'
                            />
                        </div>

                        <div
                            v-if='ungroupedSection'
                            v-sortable-list='dragEnabled'
                            class='overlay-list d-flex flex-column gap-3'
                            :data-list-key='listKeyAttr(null)'
                            data-empty='Drag an overlay here to remove it from its group'
                        >
                            <OverlayRow
                                v-for='card in ungroupedSection.cards'
                                :key='card.overlay.id'
                                :card='card'
                                :editing='isDraggable'
                                :opened='opened.has(card.overlay.id)'
                                @toggle='handleCardClick(card.overlay)'
                                @update='void updateOverlay(card.overlay, $event)'
                                @remove='void removeOverlay(card.overlay.id)'
                            />
                        </div>

                        <!-- Groups are drawn above the ungrouped overlays and above the groups listed before them -->
                        <div
                            v-if='groupSections.length'
                            v-sortable-groups='dragEnabled'
                            class='overlay-groups d-flex flex-column gap-3'
                        >
                            <div
                                v-for='section in groupSections'
                                :key='section.id'
                                :data-group-id='section.group.id'
                                class='overlay-group rounded-3 p-2'
                                :class='{ "border-primary": isDraggable }'
                            >
                                <div class='d-flex align-items-center gap-2'>
                                    <span
                                        v-if='dragEnabled'
                                        class='group-drag-handle flex-shrink-0 d-flex align-items-center cursor-move text-white-50'
                                        title='Drag to reorder groups'
                                    >
                                        <IconGripVertical
                                            :size='20'
                                            stroke='1'
                                        />
                                    </span>

                                    <TablerIconButton
                                        :title='section.group.collapsed ? "Expand Group" : "Collapse Group"'
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
                                        :title='section.state === "all" ? "Hide Group Overlays" : "Show Group Overlays"'
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
                                            title='Save Name'
                                            @click='void saveRename(section.group)'
                                        >
                                            <IconCheck
                                                :size='20'
                                                stroke='1'
                                            />
                                        </TablerIconButton>
                                        <TablerIconButton
                                            title='Cancel'
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
                                            class='group-name fw-semibold flex-grow-1 text-break'
                                            v-text='section.group.name'
                                        />
                                        <span
                                            class='badge rounded-pill text-bg-secondary'
                                            :title='`${section.members.length} Overlays`'
                                            v-text='section.members.length'
                                        />
                                        <TablerIconButton
                                            title='Rename Group'
                                            @click='void startRename(section.group)'
                                        >
                                            <IconCursorText
                                                :size='20'
                                                stroke='1'
                                            />
                                        </TablerIconButton>
                                        <TablerDelete
                                            title='Delete Group'
                                            label='Delete Group'
                                            :size='20'
                                            displaytype='icon'
                                            @delete='void deleteGroup(section.group)'
                                        />
                                    </template>
                                </div>

                                <!-- v-show on a plain wrapper: Bootstrap's d-flex is display:flex !important and would beat v-show's display:none -->
                                <div v-show='!section.group.collapsed'>
                                    <div
                                        v-sortable-list='dragEnabled'
                                        class='overlay-list d-flex flex-column gap-3 mt-2'
                                        :data-list-key='listKeyAttr(section.key)'
                                        :data-empty='isDraggable ? "Drag overlays here" : "No overlays in this group"'
                                    >
                                        <OverlayRow
                                            v-for='card in section.cards'
                                            :key='card.overlay.id'
                                            :card='card'
                                            :editing='isDraggable'
                                            :opened='opened.has(card.overlay.id)'
                                            @toggle='handleCardClick(card.overlay)'
                                            @update='void updateOverlay(card.overlay, $event)'
                                            @remove='void removeOverlay(card.overlay.id)'
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div
                            v-if='internalCards.length'
                            class='overlay-list d-flex flex-column gap-3'
                        >
                            <OverlayRow
                                v-for='card in internalCards'
                                :key='card.overlay.id'
                                :card='card'
                                :editing='isDraggable'
                                :opened='opened.has(card.overlay.id)'
                                @toggle='handleCardClick(card.overlay)'
                                @update='void updateOverlay(card.overlay, $event)'
                                @remove='void removeOverlay(card.overlay.id)'
                            />
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
import { ref, watch, computed, nextTick, useTemplateRef, onMounted, onBeforeUnmount } from 'vue';
import type { Directive } from 'vue';
import { useRouter } from 'vue-router';
import type { Subscription } from 'dexie';
import MenuTemplate from '../util/MenuTemplate.vue';
import {
    TablerDelete,
    TablerIconButton,
    TablerInput,
    TablerLoading,
    TablerNone
} from '@tak-ps/vue-tabler';
import OverlayRow from './Overlays/OverlayRow.vue';
import type { OverlayBadge, OverlayCard, OverlayStatus, OverlayUpdate } from './Overlays/overlay-card.ts';
import {
    IconGripVertical,
    IconPencil,
    IconPencilCheck,
    IconPlus,
    IconFolderPlus,
    IconChevronDown,
    IconChevronRight,
    IconCursorText,
    IconCheck,
    IconX
} from '@tabler/icons-vue';
import Sortable from 'sortablejs';
import type { SortableEvent } from 'sortablejs';
import { setAllVisible, visibilityState } from '../../../base/overlay-visibility.ts';
import type { VisibilityState } from '../../../base/overlay-visibility.ts';
import {
    GROUP_NAME_MAX,
    moveInLayout,
    moveIndex,
    normalizeGroupName,
    partitionLayout,
    partitionOverlays,
    renumberGroups,
    restoreNode,
    sortGroups,
    stackOrder
} from '../../../base/overlay-groups.ts';
import type { OverlayListKey } from '../../../base/overlay-groups.ts';
import OverlayGroupManager from '../../../base/overlay-group-manager.ts';
import type Overlay from '../../../../src/base/overlay-class.ts';
import type { DBOverlay } from '../../../../src/database.ts';
import type { ProfileOverlayGroup } from '../../../types.ts';
import OverlayManager from '../../../../src/base/overlay.ts';
import { useMapStore } from '../../../stores/map.ts';
import { profileAssetIdFromUrl } from '../../../utils/offline-tiles.ts';

type OverlaySection = {
    id: string;
    key: OverlayListKey;
    group: ProfileOverlayGroup;
    cards: OverlayCard[];
    /** Every overlay of the group, including those hidden by the search */
    members: OverlayCard[];
    state: VisibilityState;
};

const router = useRouter();
const mapStore = useMapStore();

/** Sortables by list element - created and destroyed with their element by the directives below */
const sortables = new Map<HTMLElement, Sortable>();

const isDraggable = ref(false);
const loading = ref(false);
const opened = ref<Set<number>>(new Set());
const overlayFilter = ref('');
const overlayRenderTick = ref(0);

const dbOverlays = ref<DBOverlay[]>([]);
const groups = ref<ProfileOverlayGroup[]>([]);
/** Groups must be known before a drop, or the drop would ungroup the overlay */
const groupsLoaded = ref(false);

const creatingGroup = ref(false);
const newGroupName = ref('');
const renamingGroupId = ref<number | null>(null);
const renameValue = ref('');
const groupBusy = ref(false);
const groupError = ref('');

let listSubscription: Subscription | undefined;

/** nextSibling of the row or group being dragged, recorded on drag start */
let dragNext: Node | null = null;

const newGroupInput = useTemplateRef<HTMLInputElement>('newGroupInput');
const renameInput = useTemplateRef<HTMLInputElement[] | HTMLInputElement>('renameInput');

const hasSearchTerm = computed(() => overlayFilter.value.trim().length > 0);

const dragEnabled = computed(() => isDraggable.value && groupsLoaded.value && !hasSearchTerm.value);

function overlayMatchesTerm(overlay: Overlay, term: string): boolean {
    return (
        (overlay.name ?? '').toLowerCase().includes(term)
        || (overlay.type ?? '').toLowerCase().includes(term)
        || (overlay.mode ?? '').toLowerCase().includes(term)
    );
}

/** Cards of every overlay in map stacking order, ignoring the search */
const allCards = computed<OverlayCard[]>(() => {
    void overlayRenderTick.value;

    const records = new Map(dbOverlays.value.map((record) => [record.id, record]));
    const seen = new Set<number>();
    const cards: OverlayCard[] = [];

    const consider = (overlay: Overlay | undefined): void => {
        if (!overlay || seen.has(overlay.id)) return;
        seen.add(overlay.id);

        // The local record is written on every change (also from other
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

/*
 * Menu, top to bottom - the map stack, bottom to top: the basemap, the
 * ungrouped overlays, the groups (lowest `pos` first) and the internal
 * overlays ("Map Features")
 */
const basemapCards = computed(() => overlayCards.value.filter((card) => card.overlay.mode === 'basemap'));
const internalCards = computed(() => overlayCards.value.filter((card) => OverlayManager.isPinned(card.overlay) && card.overlay.mode !== 'basemap'));

const groupSections = computed<OverlaySection[]>(() => {
    const shown = new Set(overlayCards.value);
    const result: OverlaySection[] = [];

    for (const { group, items } of partition.value.groups) {
        const cards = items.filter((card) => shown.has(card));
        if (hasSearchTerm.value && !cards.length) continue;

        result.push({
            id: `group-${group.id}`,
            key: group.id,
            group,
            cards,
            members: items,
            state: visibilityState(items)
        });
    }

    return result;
});

/** The ungrouped overlays - kept as an (empty) drop target while reordering so an overlay can be taken out of a group */
const ungroupedSection = computed<{ cards: OverlayCard[] } | null>(() => {
    const shown = new Set(overlayCards.value);
    const cards = partition.value.ungrouped.filter((card) => shown.has(card));
    if (!cards.length && !(isDraggable.value && partition.value.groups.length)) return null;
    return { cards };
});

const hasRows = computed(() => basemapCards.value.length > 0
    || ungroupedSection.value !== null
    || groupSections.value.length > 0
    || internalCards.value.length > 0);

const sortableCount = computed(() => allCards.value.filter((card) => !OverlayManager.isPinned(card.overlay)).length);

/** Something can be moved: two overlays, an overlay and a group, or two groups */
const hasOrder = computed(() => sortableCount.value > 1
    || (sortableCount.value > 0 && groups.value.length > 0)
    || groups.value.length > 1);

const canEditOrder = computed(() => !hasSearchTerm.value && hasOrder.value);

const showDragHint = computed(() => hasOrder.value && !isDraggable.value && !canEditOrder.value);

const dragHintCopy = computed(() => {
    if (!showDragHint.value) return '';
    return 'Reordering available once you clear the search.';
});

const reorderButtonTitle = computed(() => {
    if (isDraggable.value) return 'Save Order';
    if (!canEditOrder.value) {
        if (!hasOrder.value) return 'Add another overlay to reorder';
        return 'Clear the search to reorder overlays';
    }
    return 'Edit Order';
});

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
});

watch(overlayFilter, () => {
    if (isDraggable.value && !canEditOrder.value) {
        isDraggable.value = false;
    }
});

/*
 * Sortables live and die with their list element. The lists are rendered in
 * the slot of MenuTemplate, so this component's own onUpdated does not run
 * when a list appears (a group created at runtime, the lists shown after
 * loading) - a directive is bound to the element itself and always does.
 */
function bindSortable(el: HTMLElement, enabled: boolean, options: Sortable.Options): void {
    sortables.set(el, new Sortable(el, { ...options, disabled: !enabled }));
}

function unbindSortable(el: HTMLElement): void {
    sortables.get(el)?.destroy();
    sortables.delete(el);
}

function toggleSortable(el: HTMLElement, enabled: boolean): void {
    const sortable = sortables.get(el);
    if (sortable && sortable.option('disabled') === enabled) sortable.option('disabled', !enabled);
}

/** A list of overlays (a group or the ungrouped list) - rows move between all of them */
const vSortableList: Directive<HTMLElement, boolean> = {
    mounted: (el, binding) => bindSortable(el, binding.value, {
        group: 'overlays',
        sort: true,
        handle: '.drag-handle',
        draggable: '.overlay-row',
        dataIdAttr: 'id',
        // An empty group is a small target - accept a drop near it
        emptyInsertThreshold: 24,
        onStart: (ev) => { dragNext = ev.item.nextSibling; },
        onEnd: (ev) => void handleDrop(ev)
    }),
    updated: (el, binding) => toggleSortable(el, binding.value),
    beforeUnmount: (el) => unbindSortable(el)
};

/** The container of the groups - a group only moves among the groups */
const vSortableGroups: Directive<HTMLElement, boolean> = {
    mounted: (el, binding) => bindSortable(el, binding.value, {
        group: 'overlay-groups',
        sort: true,
        handle: '.group-drag-handle',
        draggable: '.overlay-group',
        onStart: (ev) => { dragNext = ev.item.nextSibling; },
        onEnd: (ev) => void handleGroupDrop(ev)
    }),
    updated: (el, binding) => toggleSortable(el, binding.value),
    beforeUnmount: (el) => unbindSortable(el)
};

onBeforeUnmount(() => {
    listSubscription?.unsubscribe();
    listSubscription = undefined;

    for (const sortable of sortables.values()) sortable.destroy();
    sortables.clear();
});

function handleReorderToggle() {
    if (isDraggable.value) {
        isDraggable.value = false;
        return;
    }

    if (!canEditOrder.value) return;

    isDraggable.value = true;
}

function toggleOverlay(id: number) {
    if (opened.value.has(id)) {
        opened.value.delete(id);
    } else {
        opened.value.add(id);
    }
}

function handleCardClick(overlay: Overlay) {
    if (isDraggable.value) return;
    if (overlay.id === 0) return;
    if (!hasOverlayDetails(overlay)) return;
    toggleOverlay(overlay.id);
}

/** Whether an overlay has an expandable details panel. Mission overlays are managed from MenuMission and are not expandable here. */
function hasOverlayDetails(overlay: Overlay): boolean {
    return overlay.type === 'raster'
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
    }

    if (!overlay.visible) {
        addBadge({ label: 'Hidden', variant: 'dark' });
    }

    return badges;
}

/**
 * An overlay was dropped. Sortable moved its DOM node - it is put back so Vue
 * stays the only owner of the rows, and the new order and group are applied
 * to the data instead, which Vue then renders.
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

        const reorder = OverlayManager.reorderLoaded(stackOrder(layout), id, { groupId });

        // Show the new membership right away - the local record follows
        if (groupId !== undefined) {
            dbOverlays.value = dbOverlays.value.map((record) => record.id === id ? { ...record, group_id: groupId } : record);
        }
        overlayRenderTick.value += 1;

        await reorder;
    } catch (err) {
        console.error('Failed to sync overlay order:', err);
        groupError.value = errorText('Failed to move overlay', err);
        // The group may be gone on another device - reload groups and overlays
        void loadGroups();
        OverlayManager.sync().catch((syncErr: unknown) => console.error('Failed to resync overlays:', syncErr));
    } finally {
        overlayRenderTick.value += 1;
    }
}

/**
 * A group was dropped. As with overlays the DOM node is put back; the groups
 * are renumbered in their new order and the map stack follows them.
 */
async function handleGroupDrop(ev: SortableEvent): Promise<void> {
    const { item, from, oldIndex, newIndex } = ev;

    restoreNode(item, from, dragNext);
    dragNext = null;

    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;

    const order = sortGroups(groups.value).map((group) => group.id);
    if (order[oldIndex] !== Number(item.dataset.groupId)) return;

    const changes = renumberGroups(groups.value, moveIndex(order, oldIndex, newIndex));
    const posOf = new Map(changes.map((change) => [change.id, change.pos]));

    groups.value = groups.value.map((group) => posOf.has(group.id) ? { ...group, pos: posOf.get(group.id) as number } : group);

    try {
        const restack = OverlayManager.restackLoaded(stackOrder(partitionLayout(partition.value, (card) => card.overlay.id)));
        overlayRenderTick.value += 1;

        await Promise.all([
            ...changes.map((change) => OverlayGroupManager.update(change.id, { pos: change.pos })),
            restack
        ]);
    } catch (err) {
        console.error('Failed to sync overlay group order:', err);
        groupError.value = errorText('Failed to move group', err);
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

async function toggleGroup(ev: Event, members: OverlayCard[], state: VisibilityState): Promise<void> {
    await setAllVisible(members, state !== 'all', (card, body) => updateOverlay(card.overlay, body));

    // Keep the checkbox in line with the overlays even when every update failed and Vue sees no change
    const el = ev.target as HTMLInputElement | null;
    if (!el) return;
    const current = visibilityState(members.map((card) => ({ visible: card.overlay.visible })));
    el.checked = current === 'all';
    el.indeterminate = current === 'some';
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
        // The server gives a new group the lowest position - it is listed first
        const group = await OverlayGroupManager.create(name);
        groups.value = sortGroups([...groups.value, group]);
        cancelCreateGroup();
    } catch (err) {
        groupError.value = errorText('Failed to create group', err);
    } finally {
        groupBusy.value = false;
    }
}

async function startRename(group: ProfileOverlayGroup): Promise<void> {
    groupError.value = '';
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
        groupError.value = `Group name must be 1-${GROUP_NAME_MAX} characters`;
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
        groupError.value = errorText('Failed to rename group', err);
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

/** Delete a group - its overlays are kept and listed as ungrouped */
async function deleteGroup(group: ProfileOverlayGroup): Promise<void> {
    if (groupBusy.value) return;

    groupBusy.value = true;
    groupError.value = '';

    try {
        await OverlayGroupManager.delete(group.id);
        groups.value = groups.value.filter((current) => current.id !== group.id);
        dbOverlays.value = dbOverlays.value.map((record) => record.group_id === group.id ? { ...record, group_id: null } : record);

        // The former members keep their positions - restack so the map
        // matches the menu, where they are now ungrouped
        await OverlayManager.restackLoaded(stackOrder(partitionLayout(partition.value, (card) => card.overlay.id)));
    } catch (err) {
        groupError.value = errorText('Failed to delete group', err);
    } finally {
        groupBusy.value = false;
        overlayRenderTick.value += 1;
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

.group-drag-handle {
    touch-action: none;
}
</style>
