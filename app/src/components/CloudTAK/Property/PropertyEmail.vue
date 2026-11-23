<template>
    <PropertyFactRow
        :label='t("property.email.label")'
        class='py-1'
    >
        <a
            :href='`mailto:${email}`'
            class='text-reset d-block text-truncate'
            v-text='email'
        />
    </PropertyFactRow>
</template>

<script setup lang='ts'>
import PropertyFactRow from '../util/PropertyFactRow.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
    email: string;
}>();
</script>
