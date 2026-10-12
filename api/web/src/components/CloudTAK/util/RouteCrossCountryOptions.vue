<template>
    <div class='route-cross-country-options'>
        <div class='text-secondary small mb-1'>
            Opcje przełaju
        </div>
        <TablerToggle
            :model-value='!!modelValue?.avoid_wetland'
            class='avoid-wetland'
            label='Omijaj bagna'
            :disabled='disabled'
            @update:model-value='change({ avoid_wetland: $event })'
        />
        <TablerToggle
            :model-value='!!modelValue?.avoid_streams'
            class='avoid-streams'
            label='Omijaj strumienie i rowy'
            :disabled='disabled'
            @update:model-value='change({ avoid_streams: $event })'
        />
        <TablerEnum
            :model-value='slopeLabel'
            class='max-slope'
            label='Największe nachylenie'
            :options='slopeChoices'
            :disabled='disabled'
            @update:model-value='change({ max_slope_deg: slopeValue($event) })'
        />
        <TablerEnum
            :model-value='exposureLabel'
            class='exposure'
            label='Ekspozycja'
            description='Średnia i unikaj prowadzą trasę lasem zamiast przez pola i drogi. Model zna rodzaj terenu z OSM, ale nie gęstość lasu.'
            :options='Object.keys(EXPOSURE_CHOICES)'
            :disabled='disabled'
            @update:model-value='change({ exposure: EXPOSURE_CHOICES[$event] })'
        />
        <TablerToggle
            :model-value='!!modelValue?.avoid_observation'
            class='avoid-observation'
            label='Unikaj widoczności ze wzgórz'
            description='Trasa omija pole widzenia dominujących wzgórz do 3 km.'
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
import { TablerEnum, TablerToggle } from '@tak-ps/vue-tabler';
import type { RouteOptions } from '../../../base/route-plan.ts';

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

const slopeLabel = computed(() => {
    const slope = props.modelValue?.max_slope_deg;
    return slope === undefined || slope >= MAX_SLOPE_DEG ? NO_SLOPE_LIMIT : `${slope}°`;
});

// Limit spoza listy (np. z planu zapisanego innym klientem) też musi dać się pokazać
const slopeChoices = computed(() => {
    const choices = [NO_SLOPE_LIMIT, ...SLOPE_STEPS.map((step) => `${step}°`)];
    if (!choices.includes(slopeLabel.value)) choices.push(slopeLabel.value);
    return choices;
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
    emit('update:modelValue', Object.keys(options).length ? options : undefined);
}
</script>
