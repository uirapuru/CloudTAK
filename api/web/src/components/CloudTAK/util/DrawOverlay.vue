<template>
    <GenericBottomPane>
        <div
            v-if='mapStore.draw.mode === DrawToolMode.POINT'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <template v-if='!appStore.isMobileDetected'>
                    <CoordinateType
                        v-model='mapStore.draw.point.type'
                    />
                </template>
                <template v-else>
                    <IconPoint
                        :size='24'
                        stroke='1'
                    /><span class='mx-2'>Draw Point</span>
                </template>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        v-if='appStore.isMobileDetected'
                        :title='opened ? "Close Settings" : "Open Settings"'
                        @click='opened = !opened'
                    >
                        <span class='d-flex align-items-center'>
                            <span>More</span>
                            <IconChevronDown
                                v-if='opened'
                                :size='24'
                                stroke='1'
                            />
                            <IconChevronUp
                                v-else
                                :size='24'
                                stroke='1'
                            />
                        </span>
                    </TablerIconButton>
                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
            <div
                v-if='appStore.isMobileDetected && opened'
                class='card-body'
            >
                <CoordinateType
                    v-model='mapStore.draw.point.type'
                />
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.CIRCLE'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconCircle
                    :size='24'
                    stroke='1'
                />
                <span class='mx-2'>Circle Editing</span>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.RECTANGLE'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconVector
                    :size='24'
                    stroke='1'
                /><span class='mx-2'>Rectangle Editing</span>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.LINESTRING || mapStore.draw.mode === DrawToolMode.SNAPPING'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconLine
                    :size='24'
                    stroke='1'
                /><span class='mx-2'>Line Editing</span>

                <div class='ms-auto btn-list align-items-center'>
                    <TablerEnum
                        v-if='!appStore.isMobileDetected'
                        v-model='mapStore.draw.snappingLayer'
                        description='Choose the type of line to draw.'
                        default='No Snapping'
                        :options='mapStore.draw.snappingOptions'
                        :disabled='!mapStore.hasSnapping'
                    />

                    <TablerIconButton
                        v-if='appStore.isMobileDetected'
                        :title='opened ? "Close Settings" : "Open Settings"'
                        @click='opened = !opened'
                    >
                        <span class='d-flex align-items-center'>
                            <span>More</span>
                            <IconChevronDown
                                v-if='opened'
                                :size='24'
                                stroke='1'
                            />
                            <IconChevronUp
                                v-else
                                :size='24'
                                stroke='1'
                            />
                        </span>
                    </TablerIconButton>

                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
            <div
                v-if='appStore.isMobileDetected && opened'
                class='card-body'
            >
                <TablerEnum
                    v-model='mapStore.draw.snappingLayer'
                    description='Choose the type of line to draw.'
                    default='No Snapping'
                    :options='mapStore.draw.snappingOptions'
                    :disabled='!mapStore.hasSnapping'
                />
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.POLYGON'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconPolygon
                    :size='24'
                    stroke='1'
                /><span class='mx-2'>Polygon Editing</span>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.SECTOR'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconCone
                    :size='24'
                    stroke='1'
                /><span class='mx-2'>Sector Editing</span>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.FREEHAND'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconLasso
                    :size='24'
                    stroke='1'
                /><span class='mx-2'>Lasso Select</span>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        v-if='appStore.isMobileDetected'
                        :title='opened ? "Close Settings" : "Open Settings"'
                        @click='opened = !opened'
                    >
                        <span class='d-flex align-items-center'>
                            <span>More</span>
                            <IconChevronDown
                                v-if='opened'
                                :size='24'
                                stroke='1'
                            />
                            <IconChevronUp
                                v-else
                                :size='24'
                                stroke='1'
                            />
                        </span>
                    </TablerIconButton>

                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
            <div
                v-if='!appStore.isMobileDetected || opened'
                class='card-body'
            >
                <TablerEnum
                    v-model='mapStore.draw.lasso.overlay'
                    label='Layer Selection'
                    description='Features will be selected from the chosen layer.'
                    default='Map Features'
                    :options='filteredOverlayNames'
                />
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.ROUTE'
            class='card cloudtak-panel user-select-none route-editor-panel'
        >
            <div class='card-header'>
                <IconRoute
                    :size='24'
                    stroke='1'
                /><span
                    class='mx-2'
                    v-text='mapStore.draw.routeEditorKind === "build" ? "Wyznaczanie trasy" : "Edycja trasy"'
                />

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        title='Zapisz trasę'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Anuluj'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
            <div class='card-body py-2'>
                <div
                    class='route-summary'
                    v-text='mapStore.draw.routeSummary'
                />
                <div
                    v-if='mapStore.draw.routeBusy'
                    class='text-secondary small route-busy'
                >
                    Przeliczam trasę…
                </div>
                <div
                    v-if='mapStore.draw.routeError'
                    class='text-danger small route-error'
                    v-text='mapStore.draw.routeError'
                />
                <div
                    v-if='mapStore.draw.routeMenu'
                    class='d-flex align-items-center gap-2 mt-2 route-point-menu'
                >
                    <span v-text='"Punkt " + routePointLabel(mapStore.draw.routeMenu.index)' />
                    <button
                        type='button'
                        class='btn btn-sm btn-outline-danger route-remove-point'
                        @click='mapStore.draw.removeRouteWaypoint(mapStore.draw.routeMenu.index)'
                    >
                        Usuń punkt
                    </button>
                    <button
                        type='button'
                        class='btn btn-sm btn-outline-secondary'
                        @click='mapStore.draw.routeMenu = null'
                    >
                        Zamknij
                    </button>
                </div>
                <template v-if='mapStore.draw.routeEditorKind === "edit"'>
                    <button
                        type='button'
                        class='btn btn-sm btn-outline-secondary mt-2 route-settings-toggle'
                        @click='toggleRouteSettings'
                        v-text='routeSettingsOpen ? "Ukryj tryb i opcje" : "Tryb i opcje"'
                    />
                    <div
                        v-if='routeSettingsOpen && routeModes.length'
                        class='mt-2 route-settings'
                    >
                        <TablerEnum
                            v-model='routeModeName'
                            class='route-travel-mode'
                            label='Tryb trasy'
                            :options='routeModes.map((m) => m.name)'
                            :disabled='mapStore.draw.routeBusy'
                        />
                        <div
                            v-if='routeModeId === CROSS_COUNTRY'
                            class='mt-2 route-options'
                        >
                            <RouteCrossCountryOptions
                                v-model='routeEditOptions'
                                :disabled='mapStore.draw.routeBusy'
                            />
                        </div>
                    </div>
                </template>
                <div
                    v-if='!mapStore.draw.routeMenu'
                    class='text-secondary small mt-1'
                    v-text='mapStore.draw.routeEditorKind === "build"
                        ? "Kliknij mapę, aby dodać kolejny punkt. Przeciągnij punkt albo odcinek, aby zmienić trasę."
                        : "Kliknij mapę, aby dodać punkt do najbliższego odcinka. Przeciągnij punkt albo odcinek, aby zmienić trasę."'
                />
            </div>
        </div>
        <div
            v-else-if='mapStore.draw.mode === DrawToolMode.SELECT'
            class='card cloudtak-panel user-select-none'
        >
            <div class='card-header'>
                <IconPencil
                    :size='24'
                    stroke='1'
                /><span class='mx-2'>Editing Existing Feature</span>

                <div class='ms-auto btn-list'>
                    <TablerIconButton
                        title='Finish Drawing'
                        :disabled='!mapStore.draw.canFinish'
                        @click='mapStore.draw.finish()'
                    >
                        <IconCheck
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                    <TablerIconButton
                        title='Cancel Editing'
                        @click='mapStore.draw.stop()'
                    >
                        <IconX
                            :size='24'
                            stroke='1'
                        />
                    </TablerIconButton>
                </div>
            </div>
        </div>
    </GenericBottomPane>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import GenericBottomPane from '../GenericBottomPane.vue';
import CoordinateType from '../util/CoordinateType.vue';
import { DrawToolMode } from '../../../stores/modules/draw.ts';
import { useMapStore } from '../../../stores/map.ts';
import { useAppStore } from '../../../stores/app.ts';
import OverlayManager from '../../../base/overlay.ts';
import {
    TablerEnum,
    TablerIconButton
} from '@tak-ps/vue-tabler'
import {
    IconX,
    IconLine,
    IconPoint,
    IconPencil,
    IconChevronUp,
    IconChevronDown,
    IconCircle,
    IconLasso,
    IconCone,
    IconVector,
    IconPolygon,
    IconCheck,
    IconRoute,
} from '@tabler/icons-vue';
import { waypointLabel } from '../../../base/route-plan.ts';
import type { RouteOptions } from '../../../base/route-plan.ts';
import { server } from '../../../std.ts';
import RouteCrossCountryOptions from './RouteCrossCountryOptions.vue';

const mapStore = useMapStore();
const appStore = useAppStore();

const opened = ref(false);

function routePointLabel(index: number): string {
    return waypointLabel(index, mapStore.draw.routeWaypointCount);
}

// Tryb i opcje edytowanej trasy: te same, co przy wyznaczaniu w menu trasy.
// Każda zmiana liczy trasę od nowa; odrzuconą (błąd usługi) cofamy.
const CROSS_COUNTRY = 'foot_cross_country';

const routeSettingsOpen = ref(false);
const routeModes = ref<Array<{ id: string; name: string }>>([]);
const routeModeName = ref('');
const routeEditOptions = ref<RouteOptions | undefined>();
// Obserwatory reagują dopiero po wczytaniu stanu z edytora, nie na samo wczytanie
let routeSettingsReady = false;

const routeModeId = computed(() => routeModes.value.find((m) => m.name === routeModeName.value)?.id);

async function toggleRouteSettings(): Promise<void> {
    if (routeSettingsOpen.value) {
        routeSettingsOpen.value = false;
        return;
    }

    routeSettingsReady = false;
    if (!routeModes.value.length) {
        const res = await server.GET('/api/search');
        const taklab = res.data?.route.providers.find((p) => p.id === 'taklab');
        routeModes.value = taklab ? taklab.modes : [];
    }
    routeModeName.value = routeModes.value.find((m) => m.id === mapStore.draw.routeTravelMode)?.name ?? '';
    routeEditOptions.value = mapStore.draw.routeOptions;
    routeSettingsOpen.value = true;
    await nextTick();
    routeSettingsReady = true;
}

watch(routeModeName, async (name, previous) => {
    if (!routeSettingsReady) return;
    const id = routeModes.value.find((m) => m.name === name)?.id;
    if (!id) return;
    if (!await mapStore.draw.setRouteTravelMode(id)) routeModeName.value = previous;
});

watch(routeEditOptions, async (options, previous) => {
    if (!routeSettingsReady) return;
    if (!await mapStore.draw.setRouteOptions(options)) routeEditOptions.value = previous;
});

// Zamknięcie edytora albo przejście do budowania chowa panel
watch(() => mapStore.draw.routeEditorKind, () => {
    routeSettingsOpen.value = false;
    routeSettingsReady = false;
});

const filteredOverlayNames = computed((): string[] => {
    return OverlayManager.queryableOverlayNames();
});

onMounted(async () => {
    if (mapStore.draw.mode === DrawToolMode.LINESTRING || mapStore.draw.mode === DrawToolMode.SNAPPING) {
        await mapStore.draw.populateSnappingLayers();
    }
});

watch(() => mapStore.draw.mode, async () => {
    if (mapStore.draw.mode === DrawToolMode.LINESTRING || mapStore.draw.mode === DrawToolMode.SNAPPING) {
        await mapStore.draw.populateSnappingLayers();
    }
});
</script>
