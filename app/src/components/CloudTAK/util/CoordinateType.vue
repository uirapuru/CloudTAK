<template>
    <TablerPillGroup
        v-model='config.mode'
        :options='coordOptions'
        :rounded='false'
        :full-width='false'
        size='default'
        name='point-type'
        padding=''
    >
        <template #option='{ option }'>
            <span :title='option.label'>
                <IconPoint
                    v-if='option.value === "u-d-p"'
                    :title='t("util.coordinateType.pointIcon")'
                    :size='size'
                    stroke='1'
                />
                <img
                    v-else
                    :width='size'
                    :height='size'
                    :src='symbolDataURL(option.value, props.size)'
                >
            </span>
        </template>
    </TablerPillGroup>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, watch, computed } from 'vue';
import {
    IconPoint
} from '@tabler/icons-vue';
import { TablerPillGroup } from '@tak-ps/vue-tabler';
import { LegacyPointTypes, normalizePointType } from '../../../utils/point-type.ts';
import { symbolDataURL } from '../../../utils/milsymbol.ts';

const { t } = useI18n();

// Points are created as 2525E Land Unit SIDCs where possible - u-d-p (Custom
// Point) has no 2525E equivalent and remains a traditional CoT type
const coordOptions = computed(() => [
    { value: 'u-d-p', label: t('util.coordinateType.custom') },
    { value: LegacyPointTypes['a-u-G'], label: t('util.coordinateType.unknown') },
    { value: LegacyPointTypes['a-f-G'], label: t('util.coordinateType.friendly') },
    { value: LegacyPointTypes['a-h-G'], label: t('util.coordinateType.hostile') },
    { value: LegacyPointTypes['a-n-G'], label: t('util.coordinateType.neutral') },
]);

const props = defineProps({
    modelValue: {
        type: String,
        required: true,
    },
    size: {
        type: Number,
        default: 24
    }
});

const config = ref({
    mode: normalizePointType(props.modelValue)
})

const emit = defineEmits([ 'update:modelValue' ])

watch(config.value, () => {
    emit('update:modelValue', config.value.mode);
})
</script>
