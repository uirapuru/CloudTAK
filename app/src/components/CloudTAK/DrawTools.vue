<template>
    <TablerDropdown>
        <template #default>
            <TablerIconButton
                :title='t("map.drawTools.geometryEditing")'
                class='mx-2 cloudtak-hover'
                :hover='false'
            >
                <IconPencilPlus
                    :size='40'
                    stroke='1'
                />
            </TablerIconButton>
        </template>
        <template #dropdown>
            <div
                style='min-width: 300px;'
            >
                <div class='d-flex align-items-center px-3 py-2 border-bottom'>
                    <h3 class='m-0 fw-bold'>
                        {{ t('map.drawTools.title') }}
                    </h3>
                    <div class='ms-auto btn-list'>
                        <TablerIconButton
                            :title='t("map.drawTools.searchTools")'
                            @click.stop='toggleSearch'
                        >
                            <IconSearch
                                :size='32'
                                stroke='1'
                            />
                        </TablerIconButton>
                    </div>
                </div>
                <div
                    v-if='searchVisible'
                    class='px-3 py-2'
                >
                    <TablerInput
                        v-model='search'
                        :placeholder='t("map.drawTools.searchPlaceholder")'
                        icon='search'
                        :autofocus='true'
                        class='mb-0'
                        @click.stop
                    />
                </div>
                <div class='px-2 py-2'>
                    <div
                        v-for='tool in filteredDrawTools'
                        :key='tool.key'
                        class='col-12 py-1 px-2 cloudtak-hover cursor-pointer user-select-none'
                        @click='tool.action()'
                    >
                        <component
                            :is='tool.icon'
                            :size='25'
                            stroke='1'
                        />
                        <span class='ps-2'>{{ tool.label }}</span>
                    </div>
                    <TablerNone
                        v-if='!filteredDrawTools.length'
                        :compact='true'
                        :create='false'
                        :label='t("map.drawTools.noTools")'
                    />
                </div>
            </div>
        </template>
    </TablerDropdown>
</template>

<script setup lang='ts'>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Component } from 'vue';
import { DrawToolMode } from '../../stores/modules/draw.ts';
import CoordInput from './Inputs/CoordInput.vue';
import RangeRingsInput from './Inputs/RangeRingsInput.vue';
import RangeInput from './Inputs/RangeInput.vue';
import GeoJSONInput from './Inputs/GeoJSONInput.vue';
import QuickPicInput from './Inputs/QuickPicInput.vue';
import CreateCoreEntity from './util/CreateCoreEntity.vue';
import {
    IconCamera,
    IconTarget,
    IconLasso,
    IconSearch,
    IconFileImport,
    IconCone,
    IconCircle,
    IconVector,
    IconPolygon,
    IconLine,
    IconPoint,
    IconCalendarEvent,
    IconCompass,
    IconCursorText,
    IconPencilPlus,
} from '@tabler/icons-vue';
import { useMapStore } from '../../stores/map';
import { useFloatStore } from '../../stores/float.ts';
import {
    TablerNone,
    TablerInput,
    TablerIconButton,
    TablerDropdown,
} from '@tak-ps/vue-tabler';

const mapStore = useMapStore();
const { t } = useI18n();
const floatStore = useFloatStore();

const search = ref<string>('');
const searchVisible = ref<boolean>(false);

type DrawToolItem = {
    key: string;
    label: string;
    icon: Component;
    action: () => void;
};

const drawTools = computed<DrawToolItem[]>(() => [
    { key: 'coordinate', label: t('map.drawTools.coordinateInput'), icon: IconCursorText, action: () => { openPane('coordinate-input', t('map.drawTools.coordinateEntry'), CoordInput, 420); } },
    { key: 'event', label: t('map.drawTools.createEvent'), icon: IconCalendarEvent, action: () => { openPane('create-event', t('map.drawTools.createEvent'), CreateCoreEntity, 640, 600); } },
    { key: 'quick_pic', label: t('map.drawTools.quickPic'), icon: IconCamera, action: () => { openPane('quick-pic', t('map.drawTools.quickPic'), QuickPicInput, 300); } },
    { key: 'range', label: t('map.drawTools.rangeBearing'), icon: IconCompass, action: () => { openPane('range-bearing-input', t('map.drawTools.rangeBearing'), RangeInput, 560); } },
    { key: 'range_rings', label: t('map.drawTools.rangeRings'), icon: IconTarget, action: () => { openPane('range-rings-input', t('map.drawTools.rangeRings'), RangeRingsInput, 640); } },
    { key: 'point', label: t('map.drawTools.drawPoint'), icon: IconPoint, action: () => { mapStore.draw.start(DrawToolMode.POINT); } },
    { key: 'line', label: t('map.drawTools.drawLine'), icon: IconLine, action: () => { mapStore.draw.start(DrawToolMode.LINESTRING); } },
    { key: 'polygon', label: t('map.drawTools.drawPolygon'), icon: IconPolygon, action: () => { mapStore.draw.start(DrawToolMode.POLYGON); } },
    { key: 'rectangle', label: t('map.drawTools.drawRectangle'), icon: IconVector, action: () => { mapStore.draw.start(DrawToolMode.RECTANGLE); } },
    { key: 'circle', label: t('map.drawTools.drawCircle'), icon: IconCircle, action: () => { mapStore.draw.start(DrawToolMode.CIRCLE); } },
    { key: 'sector', label: t('map.drawTools.drawSector'), icon: IconCone, action: () => { mapStore.draw.start(DrawToolMode.SECTOR); } },
    { key: 'lasso', label: t('map.drawTools.lassoSelect'), icon: IconLasso, action: () => { mapStore.draw.start(DrawToolMode.FREEHAND); } },
    { key: 'import', label: t('map.drawTools.geojsonImport'), icon: IconFileImport, action: () => { openPane('geojson-import', t('map.drawTools.geojsonImport'), GeoJSONInput, 500, 500); } },
]);

const filteredDrawTools = computed<DrawToolItem[]>(() => {
    const query = search.value.trim().toLowerCase();
    if (!query) return drawTools.value;
    return drawTools.value.filter((tool) => tool.label.toLowerCase().includes(query));
});

function openPane(uid: string, name: string, component: Component, height: number, width = 400): void {
    if (floatStore.panes.has(uid)) return;
    floatStore.add({ uid, name, component, height, width, corner: 'top-right' });
}

function toggleSearch(): void {
    searchVisible.value = !searchVisible.value;
    if (!searchVisible.value) search.value = '';
}
</script>
