<template>
    <PropertyMeasureRow
        :label='t("util.lineLength.label")'
        :model-value='inMode'
        :unit='mode'
        :units='units'
        @update:unit='mode = $event'
    />
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed, watch } from 'vue';
import { length } from '@turf/length';
import PropertyMeasureRow from './PropertyMeasureRow.vue';
import type { UnitOption } from './UnitSwitcher.vue';
import type { Geometry } from 'geojson';

const { t } = useI18n();

const units = computed<Array<UnitOption>>(() => [
    { value: 'feet', label: 'ft', title: t('util.lineLength.feet') },
    { value: 'yard', label: 'yd', title: t('util.lineLength.yards') },
    { value: 'meter', label: 'm', title: t('util.lineLength.meters') },
    { value: 'kilometer', label: 'km', title: t('util.lineLength.kilometers') },
    { value: 'mile', label: 'mi', title: t('util.lineLength.miles') },
]);

const props = withDefaults(defineProps<{
    geometry: Geometry;
    unit?: string;
}>(), {
    unit: 'mile'
});

const mode = ref(props.unit === 'kilometer' ? 'kilometer' : props.unit === 'meter' ? 'meter' : 'mile');

watch(() => props.unit, (newUnit) => {
    mode.value = newUnit === 'kilometer' ? 'kilometer' : newUnit === 'meter' ? 'meter' : 'mile';
});

const inMode = computed(() => {
    if (props.geometry.type !== 'LineString') return t('util.lineLength.notALine');

    const cotLength = length({ type: 'Feature', properties: {}, geometry: props.geometry });

    if (mode.value === 'meter') {
        return Number((cotLength * 1000).toFixed(2));
    } else if (mode.value === 'feet') {
        return Number((cotLength * 3280.84).toFixed(2));
    } else if (mode.value === 'yard') {
        return Number((cotLength * 1093.61).toFixed(2));
    } else if (mode.value === 'kilometer') {
        return Number(cotLength.toFixed(2));
    } else if (mode.value === 'mile') {
        return Number((cotLength * 0.621371).toFixed(2));
    } else {
        return 'UNKNOWN';
    }
})
</script>
