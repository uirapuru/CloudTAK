<template>
    <PropertyMeasureRow
        :label='t("util.polygonArea.label")'
        :model-value='inMode'
        :unit='mode'
        :units='units'
        @update:unit='mode = $event'
    />
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed, watch } from 'vue';
import { area } from '@turf/area';
import PropertyMeasureRow from './PropertyMeasureRow.vue';
import type { UnitOption } from './UnitSwitcher.vue';
import type { Geometry } from 'geojson';

const { t } = useI18n();

const units = computed<Array<UnitOption>>(() => [
    { value: 'square feet', label: 'ft²', title: t('util.polygonArea.squareFeet') },
    { value: 'square meter', label: 'm²', title: t('util.polygonArea.squareMeters') },
    { value: 'acre', label: t('util.polygonArea.acresShort'), title: t('util.polygonArea.acres') },
    { value: 'hectare', label: 'ha', title: t('util.polygonArea.hectares') },
]);

const props = withDefaults(defineProps<{
    geometry: Geometry;
    unit?: string;
}>(), {
    unit: 'acre'
});

const mode = ref(props.unit || 'acre');

watch(() => props.unit, (unit) => {
    mode.value = unit || 'acre';
});

const inMode = computed(() => {
    const cotArea = area(props.geometry);

    if (mode.value === 'square feet') {
        return Math.round((cotArea * 10.7639) * 1000) / 1000;
    } else if (mode.value === 'square meter') {
        return Math.round(cotArea * 1000) / 1000;
    } else if (mode.value === 'acre') {
        return Math.round((cotArea * 0.000247105) * 1000) / 1000;
    } else if (mode.value === 'hectare') {
        return Math.round((cotArea * 0.0001) * 1000) / 1000;
    } else {
        return 'UNKNOWN';
    }
})
</script>
