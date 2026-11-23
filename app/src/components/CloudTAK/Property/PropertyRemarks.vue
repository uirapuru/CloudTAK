<template>
    <div class='px-2 pt-2'>
        <label
            class='subheader user-select-none'
            v-text='label ?? t("property.remarks.label")'
        />
        <CopyField
            :model-value='modelValue'
            :display='display'
            :rows='10'
            :markdown='true'
            :edit='edit'
            :hover='edit'
            @submit='emit("submit", String($event))'
        />
    </div>
</template>

<script setup lang='ts'>
/** PropertyRemarks - the free text remarks of a feature, rendered as Markdown */
import CopyField from '../util/CopyField.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

withDefaults(defineProps<{
    modelValue: string;
    label?: string;
    /** Rendered in place of modelValue; copy still uses modelValue */
    display?: string;
    edit?: boolean;
}>(), {
    label: undefined,
    display: undefined,
    edit: false,
});

const emit = defineEmits<{
    (e: 'submit', value: string): void
}>();
</script>
