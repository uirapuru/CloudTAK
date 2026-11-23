<template>
    <PropertyFactRow
        :label='t("property.coreEntityDuration.started")'
        class='py-1'
    >
        <CopyField
            :model-value='toLocalInput(started)'
            :display='timediff(started)'
            :title='new Date(started).toLocaleString()'
            type='datetime-local'
            :edit='edit'
            :hover='edit'
            :validate='validateStarted'
            :size='24'
            @submit='emit("update:started", new Date(String($event)).toISOString())'
        />
    </PropertyFactRow>

    <PropertyFactRow
        :label='t("property.coreEntityDuration.ended")'
        class='py-1'
    >
        <CopyField
            :model-value='ended ? toLocalInput(ended) : ""'
            :display='ended ? timediff(ended) : t("property.coreEntityDuration.openEnded")'
            :title='ended ? new Date(ended).toLocaleString() : t("property.coreEntityDuration.openEnded")'
            type='datetime-local'
            :edit='edit'
            :hover='edit'
            :size='24'
            @submit='emit("update:ended", $event ? new Date(String($event)).toISOString() : null)'
        />
    </PropertyFactRow>
</template>

<script setup lang='ts'>
import CopyField from '../util/CopyField.vue';
import PropertyFactRow from '../util/PropertyFactRow.vue';
import timediff from '../../../timediff';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

withDefaults(defineProps<{
    started: string;
    /** An Event without an ended time is open ended */
    ended: string | null;
    edit?: boolean;
}>(), {
    edit: false,
});

const emit = defineEmits<{
    (e: 'update:started', value: string): void
    (e: 'update:ended', value: string | null): void
}>();

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** A datetime-local input takes local wall clock time without a zone */
function toLocalInput(iso: string): string {
    const time = new Date(iso);
    return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

function validateStarted(value: string | number): false | string {
    return String(value) ? false : t('property.coreEntityDuration.startedRequired');
}
</script>
