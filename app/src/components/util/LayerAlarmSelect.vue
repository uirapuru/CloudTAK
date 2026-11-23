<template>
    <CollapsibleCard
        :label='t("shared.layerAlarmSelect.title")'
        :summary='summary'
    >
        <template #icon>
            <IconAlarm
                :size='32'
                stroke='1'
                class='text-muted'
            />
        </template>

        <div class='row g-2'>
            <div class='col-12'>
                <TranslatedEnum
                    v-model='alarm.priority'
                    :label='t("shared.layerAlarmSelect.urgency")'
                    :disabled='disabled'
                    :options='priorityOptions'
                />
            </div>

            <TablerInlineAlert
                v-if='alarm.priority === "high"'
                severity='danger'
                :title='t("shared.layerAlarmSelect.highTitle")'
                :description='t("shared.layerAlarmSelect.highDescription")'
                :dismissable='false'
            />
            <TablerInlineAlert
                v-else-if='alarm.priority === "low"'
                severity='info'
                :title='t("shared.layerAlarmSelect.lowTitle")'
                :description='t("shared.layerAlarmSelect.lowDescription")'
                :dismissable='false'
            />

            <template v-if='alarm.priority !== "off"'>
                <TablerInlineAlert
                    v-if='Number(alarm.alarm_points) > Number(alarm.alarm_evals)'
                    severity='danger'
                    title='Invalid Alarm Configuration'
                    description='Data Points to Alarm must be less than or equal to Evaluation Periods'
                    :dismissable='false'
                />
                <div class='col-md-4'>
                    <TablerInput
                        v-model='alarm.alarm_evals'
                        :label='t("shared.layerAlarmSelect.evaluationPeriods")'
                        :disabled='disabled'
                        type='number'
                        min='1'
                        step='1'
                    />
                </div>
                <div class='col-md-4'>
                    <TablerInput
                        v-model='alarm.alarm_points'
                        :label='t("shared.layerAlarmSelect.dataPoints")'
                        :disabled='disabled'
                        type='number'
                        min='1'
                        step='1'
                    />
                </div>
                <div class='col-md-4'>
                    <TablerInput
                        v-model='alarm.alarm_period'
                        :label='t("shared.layerAlarmSelect.period")'
                        :disabled='disabled'
                        type='number'
                        min='2'
                        step='1'
                    />
                </div>
            </template>
        </div>
    </CollapsibleCard>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed, watch } from 'vue';
import type { ETLLayer } from '../../types.ts';
import { IconAlarm } from '@tabler/icons-vue';
import CollapsibleCard from './CollapsibleCard.vue';
import TranslatedEnum from '../CloudTAK/util/TranslatedEnum.vue';
import {
    TablerInput,
    TablerInlineAlert,
} from '@tak-ps/vue-tabler';

const { t } = useI18n();

type AlarmConfig = Pick<ETLLayer, 'priority' | 'alarm_evals' | 'alarm_points' | 'alarm_period'>;

const props = withDefaults(defineProps<{
    modelValue: ETLLayer;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: ETLLayer): void;
}>();

const priorityOptions = computed(() => [
    { value: 'off', label: t('shared.layerAlarmSelect.priority_off') },
    { value: 'high', label: t('shared.layerAlarmSelect.priority_high') },
    { value: 'low', label: t('shared.layerAlarmSelect.priority_low') },
]);

const alarm = ref<AlarmConfig>(fromLayer(props.modelValue));

const summary = computed(() => {
    if (alarm.value.priority === 'off') return t('shared.layerAlarmSelect.disabled');

    const params = { points: alarm.value.alarm_points, evals: alarm.value.alarm_evals, period: alarm.value.alarm_period };
    return alarm.value.priority === 'high'
        ? t('shared.layerAlarmSelect.summaryHigh', params)
        : t('shared.layerAlarmSelect.summaryLow', params);
});

watch(() => props.modelValue, (layer) => {
    const next = fromLayer(layer);
    if (JSON.stringify(next) !== JSON.stringify(alarm.value)) {
        alarm.value = next;
    }
}, {
    deep: true
});

watch(alarm, () => {
    emit('update:modelValue', {
        ...props.modelValue,
        priority: alarm.value.priority,
        alarm_evals: Number(alarm.value.alarm_evals),
        alarm_points: Number(alarm.value.alarm_points),
        alarm_period: Number(alarm.value.alarm_period),
    });
}, {
    deep: true
});

function fromLayer(layer: ETLLayer): AlarmConfig {
    return {
        priority: layer.priority,
        alarm_evals: layer.alarm_evals,
        alarm_points: layer.alarm_points,
        alarm_period: layer.alarm_period,
    };
}
</script>
