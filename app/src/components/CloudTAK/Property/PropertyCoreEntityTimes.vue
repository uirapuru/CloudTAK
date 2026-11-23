<template>
    <TimesFooter :entries='entries' />
</template>

<script setup lang='ts'>
/** PropertyCoreEntityTimes - the audit footer: when & by whom the Event was created and when it last changed */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import TimesFooter, { type TimesFooterEntry } from '../util/TimesFooter.vue';

const props = defineProps<{
    created: string;
    updated: string;
    username?: string | null;
}>();

const { t } = useI18n();

const entries = computed<Array<TimesFooterEntry>>(() => [
    { label: t('property.coreEntityTimes.created'), time: props.created, suffix: props.username ? t('property.coreEntityTimes.createdBy', { username: props.username }) : undefined },
    { label: t('property.coreEntityTimes.updated'), time: props.updated },
]);
</script>
