<template>
    <div>
        <div class='d-flex align-items-center mb-1'>
            <label
                class='form-label mb-0'
                v-text='label ?? t("shared.scheduleInput.label")'
            />
            <div class='ms-auto'>
                <TablerPillGroup
                    v-model='mode'
                    :options='[
                        { value: "rate", label: t("shared.scheduleInput.rate") },
                        { value: "cron", label: "Cron" }
                    ]'
                    :rounded='false'
                    :full-width='false'
                    :disabled='disabled'
                    size='sm'
                    padding=''
                    :name='`schedule-mode-${uid}`'
                >
                    <template #option='{ option }'>
                        <IconRepeat
                            v-if='option.value === "rate"'
                            class='me-1'
                            :size='16'
                            stroke='1.5'
                        />
                        <IconCode
                            v-else
                            class='me-1'
                            :size='16'
                            stroke='1.5'
                        />
                        {{ option.label }}
                    </template>
                </TablerPillGroup>
            </div>
        </div>

        <div v-if='mode === "rate"'>
            <div class='input-group'>
                <span class='input-group-text'>{{ t('shared.scheduleInput.every') }}</span>
                <input
                    v-model.number='rateFreq'
                    type='number'
                    min='1'
                    step='1'
                    class='form-control'
                    :class='{ "is-invalid": Boolean(errorMessage) }'
                    :disabled='disabled'
                    :aria-label='t("shared.scheduleInput.frequency")'
                >
                <select
                    v-model='rateUnit'
                    class='form-select'
                    style='max-width: 130px;'
                    :disabled='disabled'
                    :aria-label='t("shared.scheduleInput.unit")'
                >
                    <option
                        v-for='unit in SCHEDULE_UNITS'
                        :key='unit'
                        :value='unit'
                        v-text='unitLabel(unit)'
                    />
                </select>
            </div>
        </div>
        <div v-else>
            <input
                v-model='cronField'
                type='text'
                class='form-control font-monospace'
                :class='{ "is-invalid": Boolean(errorMessage) }'
                :disabled='disabled'
                placeholder='0/15 * * * ? *'
                :aria-label='t("shared.scheduleInput.cronExpression")'
            >
            <div
                v-if='!disabled'
                class='d-flex flex-wrap mt-2'
                style='gap: 0.25rem;'
            >
                <button
                    v-for='preset in CRON_PRESETS'
                    :key='preset.expression'
                    type='button'
                    class='badge bg-blue-lt cursor-pointer border-0 user-select-none'
                    @click='cronField = preset.expression'
                    v-text='preset.label'
                />
            </div>
        </div>

        <div
            v-if='errorMessage'
            class='small text-danger mt-1'
            v-text='errorMessage'
        />
        <div
            v-else-if='description'
            class='small text-secondary mt-1 d-flex align-items-center'
        >
            <IconClock2
                :size='14'
                stroke='1.5'
                class='me-1 flex-shrink-0'
            />
            <span v-text='description' />
        </div>
    </div>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed, watch, useId } from 'vue';
import type { ScheduleUnit } from '../../utils/schedule.ts';
import {
    SCHEDULE_UNITS,
    isRate,
    isCron,
    parseRate,
    serializeRate,
    cronExpression,
    serializeCron,
    validateCronExpression,
    describeSchedule,
    scheduleUnitLabel,
} from '../../utils/schedule.ts';
import { TablerPillGroup } from '@tak-ps/vue-tabler';
import {
    IconCode,
    IconClock2,
    IconRepeat,
} from '@tabler/icons-vue';

const { t } = useI18n();

const CRON_PRESETS = computed(() => [
    { label: t('shared.scheduleInput.presetEvery15'), expression: '0/15 * * * ? *' },
    { label: t('shared.scheduleInput.presetHourly'), expression: '0 * * * ? *' },
    { label: t('shared.scheduleInput.presetDaily'), expression: '15 10 * * ? *' },
    { label: t('shared.scheduleInput.presetWeekday'), expression: '0/5 8-17 ? * MON-FRI *' },
]);

const props = withDefaults(defineProps<{
    modelValue?: string | null;
    label?: string;
    disabled?: boolean;
}>(), {
    modelValue: undefined,
    label: undefined,
    disabled: false,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();

const uid = useId();

const mode = ref<'rate' | 'cron'>('rate');
const rateFreq = ref<number>(5);
const rateUnit = ref<ScheduleUnit>('minute');
const cronField = ref<string>('');

const errorMessage = computed<string | null>(() => {
    if (mode.value === 'rate') {
        if (!Number.isInteger(rateFreq.value) || rateFreq.value < 1) {
            return t('shared.scheduleInput.frequencyInvalid');
        }
        return null;
    } else {
        return validateCronExpression(cronField.value);
    }
});

const description = computed<string>(() => describeSchedule(serialize()));

function unitLabel(unit: ScheduleUnit): string {
    const label = scheduleUnitLabel(unit, Number.isInteger(rateFreq.value) ? rateFreq.value : 0);
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function serialize(): string {
    if (mode.value === 'rate') {
        return serializeRate({
            freq: Number.isInteger(rateFreq.value) ? rateFreq.value : 0,
            unit: rateUnit.value,
        });
    } else {
        return serializeCron(cronField.value);
    }
}

function applyValue(value: string): void {
    if (isRate(value)) {
        mode.value = 'rate';

        const rate = parseRate(value);
        if (rate) {
            rateFreq.value = rate.freq;
            rateUnit.value = rate.unit;
        }
    } else if (isCron(value)) {
        mode.value = 'cron';
        cronField.value = cronExpression(value);
    } else if (value.trim().split(/\s+/).length >= 5) {
        // Legacy schedules were stored as bare cron expressions - editing
        // one normalizes it to the wrapped cron(...) form
        mode.value = 'cron';
        cronField.value = value.trim();
    }
}

watch(() => props.modelValue, (value) => {
    if (!value || value === serialize()) return;
    applyValue(value);
}, { immediate: true });

// Seed an initial expression the first time Cron mode is entered
watch(mode, () => {
    if (mode.value === 'cron' && !cronField.value.trim().length) {
        cronField.value = '0/15 * * * ? *';
    }
});

// The serialized value is emitted even while invalid so the parent never
// silently saves a stale schedule - parents gate saves on validateSchedule()
watch([mode, rateFreq, rateUnit, cronField], () => {
    const serialized = serialize();
    if (serialized !== props.modelValue) {
        emit('update:modelValue', serialized);
    }
});
</script>
