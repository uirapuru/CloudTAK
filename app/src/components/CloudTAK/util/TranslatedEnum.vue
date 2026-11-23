<template>
    <div class='row'>
        <div
            v-if='label'
            class='col-12 d-flex my-1'
        >
            <label
                class='px-2 w-100'
                :class='{ required }'
                :title='description || undefined'
                v-text='label'
            />
            <slot />
        </div>
        <div class='col-12'>
            <select
                v-model='current'
                :autofocus='autofocus'
                :disabled='disabled'
                class='form-select'
                @blur='emit("blur")'
            >
                <option
                    v-for='option in normalized'
                    :key='option.value'
                    :value='option.value'
                    v-text='option.label'
                />
            </select>
        </div>
    </div>
</template>

<script setup lang='ts'>
/**
 * Drop-in replacement for TablerEnum where the stored value differs from the
 * text shown to the user (e.g. the value "meter" shown as "metr").
 */
import { ref, watch, computed } from 'vue';

export type EnumOption = string | { value: string; label: string };

const props = withDefaults(defineProps<{
    modelValue: string;
    options: EnumOption[];
    autofocus?: boolean;
    default?: string;
    required?: boolean;
    description?: string;
    disabled?: boolean;
    label?: string;
}>(), {
    autofocus: false,
    default: '',
    required: false,
    description: '',
    disabled: false,
    label: '',
});

const emit = defineEmits<{
    (e: 'blur'): void;
    (e: 'update:modelValue', value: string): void;
}>();

const normalized = computed(() => props.options.map((option) => {
    return typeof option === 'string' ? { value: option, label: option } : option;
}));

const current = ref<string>(!props.modelValue && props.default ? props.default : props.modelValue);

watch(() => props.modelValue, (value) => {
    current.value = value;
});

watch(current, (value) => {
    if (value === props.modelValue) return;
    emit('update:modelValue', value);
});
</script>
