<template>
    <div class='route-cross-country-options'>
        <div class='text-secondary small mb-1'>
            {{ t('taklab.routeCrossCountry.title') }}
        </div>
        <TablerToggle
            :model-value='!!modelValue?.avoid_wetland'
            class='avoid-wetland'
            :label='t("taklab.routeCrossCountry.avoidWetland")'
            :disabled='disabled'
            @update:model-value='change({ avoid_wetland: $event })'
        />
        <TablerToggle
            :model-value='!!modelValue?.avoid_streams'
            class='avoid-streams'
            :label='t("taklab.routeCrossCountry.avoidStreams")'
            :disabled='disabled'
            @update:model-value='change({ avoid_streams: $event })'
        />
        <TranslatedEnum
            :model-value='slopeLabel'
            class='max-slope'
            :label='t("taklab.routeCrossCountry.maxSlope")'
            :options='slopeChoices'
            :disabled='disabled'
            @update:model-value='change({ max_slope_deg: slopeValue($event) })'
        />
        <TranslatedEnum
            :model-value='exposureLabel'
            class='exposure'
            :label='t("taklab.routeCrossCountry.exposure")'
            :description='t("taklab.routeCrossCountry.exposureDescription")'
            :options='exposureChoices'
            :disabled='disabled'
            @update:model-value='change({ exposure: EXPOSURE_CHOICES[$event] })'
        />
        <TablerToggle
            :model-value='!!modelValue?.avoid_observation'
            class='avoid-observation'
            :label='t("taklab.routeCrossCountry.avoidObservation")'
            :description='t("taklab.routeCrossCountry.avoidObservationDescription")'
            :disabled='disabled'
            @update:model-value='change({ avoid_observation: $event })'
        />
    </div>
</template>

<script setup lang='ts'>
/**
 * Opcje trasy na przełaj, wspólne dla menu nowej trasy i paska edycji trasy.
 * Wartość to opcje w formacie planu trasy; pola z wartością domyślną są pomijane,
 * a brak jakiejkolwiek opcji to undefined.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { TablerToggle } from '@tak-ps/vue-tabler';
import TranslatedEnum from './TranslatedEnum.vue';
import type { RouteOptions } from '../../../base/route-plan.ts';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    modelValue?: RouteOptions;
    disabled?: boolean;
}>(), {
    modelValue: undefined,
    disabled: false,
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: RouteOptions | undefined): void;
}>();

// Wartości list (NO_SLOPE_LIMIT, klucze EXPOSURE_CHOICES) to stałe identyfikatory,
// użytkownik widzi przetłumaczone etykiety.
// Pierwsza pozycja = limit usługi terenu, czyli brak dodatkowego ograniczenia
const MAX_SLOPE_DEG = 35;
const NO_SLOPE_LIMIT = 'bez limitu (35°)';
const SLOPE_STEPS = [25, 20, 15, 10];

// Etykieta w formularzu → wartość API; pierwsza = bez kary za teren odsłonięty
const EXPOSURE_CHOICES: Record<string, NonNullable<RouteOptions['exposure']>> = {
    'może być': 'allow',
    'średnia': 'medium',
    'unikaj': 'avoid',
};

const EXPOSURE_LABELS: Record<string, string> = {
    'może być': 'taklab.routeCrossCountry.exposureAllow',
    'średnia': 'taklab.routeCrossCountry.exposureMedium',
    'unikaj': 'taklab.routeCrossCountry.exposureAvoid',
};

const exposureChoices = computed(() => Object.keys(EXPOSURE_CHOICES)
    .map((value) => ({ value, label: t(EXPOSURE_LABELS[value]) })));

const slopeLabel = computed(() => {
    const slope = props.modelValue?.max_slope_deg;
    return slope === undefined || slope >= MAX_SLOPE_DEG ? NO_SLOPE_LIMIT : `${slope}°`;
});

// Limit spoza listy (np. z planu zapisanego innym klientem) też musi dać się pokazać
const slopeChoices = computed(() => {
    const choices = [NO_SLOPE_LIMIT, ...SLOPE_STEPS.map((step) => `${step}°`)];
    if (!choices.includes(slopeLabel.value)) choices.push(slopeLabel.value);
    return choices.map((value) => ({
        value,
        label: value === NO_SLOPE_LIMIT ? t('taklab.routeCrossCountry.noSlopeLimit') : value,
    }));
});

const exposureLabel = computed(() => {
    const exposure = props.modelValue?.exposure ?? 'allow';
    return Object.keys(EXPOSURE_CHOICES).find((label) => EXPOSURE_CHOICES[label] === exposure) ?? 'może być';
});

function slopeValue(label: string): number | undefined {
    return label === NO_SLOPE_LIMIT ? undefined : parseInt(label, 10);
}

function change(patch: RouteOptions): void {
    const merged: RouteOptions = { ...props.modelValue, ...patch };
    const options: RouteOptions = {};
    if (merged.avoid_wetland) options.avoid_wetland = true;
    if (merged.avoid_streams) options.avoid_streams = true;
    if (merged.max_slope_deg !== undefined && merged.max_slope_deg < MAX_SLOPE_DEG) options.max_slope_deg = merged.max_slope_deg;
    if (merged.exposure && merged.exposure !== 'allow') options.exposure = merged.exposure;
    if (merged.avoid_observation) options.avoid_observation = true;
    // Opcja wszystkich trybów, ustawiana przełącznikiem stref niebezpiecznych
    if (merged.ignore_danger_zones) options.ignore_danger_zones = true;
    emit('update:modelValue', Object.keys(options).length ? options : undefined);
}
</script>
