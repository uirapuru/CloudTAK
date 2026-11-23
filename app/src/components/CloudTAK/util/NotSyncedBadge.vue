<template>
    <TablerBadge
        class='small d-flex align-items-center flex-shrink-0'
        background-color='rgba(66, 153, 225, 0.15)'
        border-color='rgba(66, 153, 225, 0.35)'
        text-color='#4299e1'
        :title='title'
    >
        <template v-if='loading'>
            <span
                class='spinner-border me-1'
                style='width: 12px; height: 12px; border-width: 1px;'
                role='status'
            />
            {{ t('util.notSyncedBadge.syncing') }}
        </template>
        <template v-else>
            <IconCloudOff
                :size='14'
                stroke='1'
                class='me-1'
            />
            {{ t('util.notSyncedBadge.notSynced') }}
        </template>
    </TablerBadge>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { IconCloudOff } from '@tabler/icons-vue';
import { TablerBadge } from '@tak-ps/vue-tabler';

const { t } = useI18n();

const props = defineProps<{
    /** The last error encountered submitting the change to the server */
    error?: string
    /** The change is currently being submitted to the server */
    loading?: boolean
    /** Append a hint to the tooltip that clicking the badge retries the sync */
    retry?: boolean
}>();

const title = computed<string>(() => {
    if (props.loading) return t('util.notSyncedBadge.submitting');

    const reason = props.error
        ? t('util.notSyncedBadge.savedLocallyError', { error: props.error })
        : t('util.notSyncedBadge.savedLocally');
    return props.retry ? t('util.notSyncedBadge.retry', { reason }) : reason;
});
</script>
