<template>
    <TablerToggle
        :model-value='!modelValue?.ignore_danger_zones'
        class='avoid-danger-zones'
        label='Omijaj strefy niebezpieczne'
        description='Strefa niebezpieczna to figura z zaznaczonym polem „Strefa niebezpieczna” w jej widoku (geofence z alarmem przy wejściu) albo z „zamknięt” w nazwie.'
        :disabled='disabled'
        @update:model-value='change($event)'
    />
</template>

<script setup lang='ts'>
/**
 * Przełącznik omijania stref niebezpiecznych, wspólny dla menu nowej trasy i paska
 * edycji trasy. Wartość to opcje trasy w formacie planu: wyłączenie omijania zapisuje
 * ignore_danger_zones, pozostałe opcje przechodzą bez zmian.
 */
import { TablerToggle } from '@tak-ps/vue-tabler';
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

function change(avoid: boolean): void {
    const options: RouteOptions = { ...props.modelValue };
    if (avoid) delete options.ignore_danger_zones;
    else options.ignore_danger_zones = true;
    emit('update:modelValue', Object.keys(options).length ? options : undefined);
}
</script>
