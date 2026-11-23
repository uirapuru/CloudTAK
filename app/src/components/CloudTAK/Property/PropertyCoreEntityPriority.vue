<template>
    <PropertyFactRow :label='t("property.coreEntityPriority.label")'>
        <TablerPillGroup
            v-if='edit'
            :model-value='modelValue'
            :options='options'
            size='sm'
            :rounded='false'
            padding=''
            @update:model-value='emit("update:modelValue", $event)'
        />
        <TablerBadge
            v-else
            :background-color='badge.background'
            :border-color='badge.border'
            :text-color='badge.text'
        >
            {{ t(`property.common.priority.${modelValue}`) }}
        </TablerBadge>
    </PropertyFactRow>
</template>

<script setup lang='ts'>
import { computed } from 'vue';
import { TablerBadge, TablerPillGroup } from '@tak-ps/vue-tabler';
import PropertyFactRow from '../util/PropertyFactRow.vue';
import { PRIORITIES, priorityBadge } from '../../../utils/priority.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
    modelValue: string;
    edit?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void
}>();

const options = computed(() => PRIORITIES.map((priority) => ({
    value: priority,
    label: t(`property.common.priority.${priority}`),
})));

const badge = computed(() => priorityBadge(props.modelValue));
</script>
