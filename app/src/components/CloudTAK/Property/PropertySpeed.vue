<template>
    <PropertyMeasureRow
        :label='label ?? t("property.speed.label")'
        :model-value='inMode'
        :unit='mode'
        :inline='inline'
        :units='units'
        @update:unit='mode = $event'
    />
</template>

<script setup lang='ts'>
import { ref, computed, watchEffect } from 'vue';
import PropertyMeasureRow from '../util/PropertyMeasureRow.vue';
import type { UnitOption } from '../util/UnitSwitcher.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const units = computed<Array<UnitOption>>(() => [
    { value: 'mi/h', label: 'mph', title: t('property.speed.milesPerHour') },
    { value: 'km/h', label: 'km/h', title: t('property.speed.kilometersPerHour') },
    { value: 'm/s', label: 'm/s', title: t('property.speed.metersPerSecond') },
]);

const props = defineProps({
    label: {
        type: String,
        default: undefined
    },
    speed: {
        type: Number,
        required: true
    },
    unit: {
        type: String,
        default: 'mi/h'
    }
,
    inline: {
        type: Boolean,
        default: false
    }
});

const mode = ref(props.unit);

watchEffect(() => {
    mode.value = props.unit;
});

const inMode = computed(() => {
    if (mode.value === 'm/s') return Math.round(props.speed * 1000) / 1000;
    else if (mode.value === 'mi/h') return Math.round(props.speed * 2.23694 * 100) / 100;
    else if (mode.value === 'km/h') return Math.round(props.speed * 3.6 * 100) / 100;
    return t('property.common.unknown');
});
</script>
