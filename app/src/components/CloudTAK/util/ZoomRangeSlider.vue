<template>
    <div
        class='zoom-range'
        :class='{ "zoom-range--disabled": disabled }'
    >
        <div class='zoom-range__track'>
            <div
                class='zoom-range__fill'
                :style='fillStyle'
            />
            <input
                class='zoom-range__input'
                type='range'
                :min='min'
                :max='max'
                step='1'
                :value='low'
                :disabled='disabled'
                :aria-label='t("map.areaPackage.zoomMin")'
                @input='onInput(0, $event)'
                @keydown='onKey(0, $event)'
            >
            <input
                class='zoom-range__input'
                type='range'
                :min='min'
                :max='max'
                step='1'
                :value='high'
                :disabled='disabled'
                :aria-label='t("map.areaPackage.zoomMax")'
                @input='onInput(1, $event)'
                @keydown='onKey(1, $event)'
            >
        </div>
        <span class='zoom-range__label'>{{ low }}–{{ high }}</span>
    </div>
</template>

<script setup lang='ts'>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = withDefaults(defineProps<{
    modelValue: [number, number];
    min: number;
    max: number;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    'update:modelValue': [value: [number, number]];
}>();

function clamp(value: number): number {
    return Math.min(props.max, Math.max(props.min, Math.round(value)));
}

const low = computed(() => clamp(Math.min(props.modelValue[0], props.modelValue[1])));
const high = computed(() => clamp(Math.max(props.modelValue[0], props.modelValue[1])));

const fillStyle = computed(() => {
    const span = props.max - props.min || 1;
    return {
        left: `${(low.value - props.min) / span * 100}%`,
        right: `${100 - (high.value - props.min) / span * 100}%`,
    };
});

function update(handle: 0 | 1, value: number): void {
    const v = clamp(value);

    // A handle cannot pass the other one: it stops where the other handle is
    if (handle === 0) {
        emit('update:modelValue', [Math.min(v, high.value), high.value]);
    } else {
        emit('update:modelValue', [low.value, Math.max(v, low.value)]);
    }
}

function onInput(handle: 0 | 1, event: Event): void {
    update(handle, Number((event.target as HTMLInputElement).value));
}

function onKey(handle: 0 | 1, event: KeyboardEvent): void {
    const delta = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1
        : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1
            : 0;

    if (!delta) return;

    event.preventDefault();
    update(handle, (handle === 0 ? low.value : high.value) + delta);
}
</script>

<style scoped>
.zoom-range {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.zoom-range__track {
    position: relative;
    flex: 1;
    height: 1.5rem;
}

.zoom-range__track::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 4px;
    transform: translateY(-50%);
    border-radius: 2px;
    background: var(--tblr-border-color, #3a4859);
}

.zoom-range__fill {
    position: absolute;
    top: 50%;
    height: 4px;
    transform: translateY(-50%);
    border-radius: 2px;
    background: var(--tblr-primary, #206bc4);
}

.zoom-range__input {
    position: absolute;
    inset: 0;
    width: 100%;
    margin: 0;
    background: none;
    pointer-events: none;
    appearance: none;
}

.zoom-range__input::-webkit-slider-thumb {
    pointer-events: auto;
    appearance: none;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--tblr-primary, #206bc4);
    border: 2px solid #fff;
    cursor: pointer;
}

.zoom-range__input::-moz-range-thumb {
    pointer-events: auto;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--tblr-primary, #206bc4);
    border: 2px solid #fff;
    cursor: pointer;
}

.zoom-range__input::-moz-range-track {
    background: none;
}

.zoom-range__label {
    min-width: 3.5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.zoom-range--disabled {
    opacity: 0.5;
}
</style>
