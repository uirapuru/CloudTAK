<template>
    <TimesFooter :entries='entries' />
</template>

<script setup lang='ts'>
/** PropertyTimes - the audit footer of a CoT: when it was reported, when it is in effect and when it goes stale */
import { computed } from 'vue';
import TimesFooter, { type TimesFooterEntry } from '../util/TimesFooter.vue';
import type COT from '../../../base/cot';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
    cot: COT
}>();

const entries = computed<Array<TimesFooterEntry>>(() => {
    const entries: Array<TimesFooterEntry> = [
        { label: t('property.times.updated'), time: props.cot.properties.time }
    ];

    if (props.cot.properties.start && props.cot.properties.start !== props.cot.properties.time) {
        entries.push({ label: t('property.times.start'), time: props.cot.properties.start });
    }

    entries.push({ label: t('property.times.stale'), time: props.cot.properties.stale });

    return entries;
});
</script>
