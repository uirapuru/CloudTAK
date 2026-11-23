<template>
    <TablerBadge
        class='small d-inline-flex align-items-center flex-shrink-0 fw-semibold'
        background-color='#206bc4'
        border-color='#206bc4'
        text-color='#ffffff'
        :title='title || t("util.offlineBadge.title")'
    >
        <IconDeviceMobileCheck
            :size='14'
            stroke='2'
            class='me-1'
        />
        {{ t('util.offlineBadge.offline') }}
    </TablerBadge>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { IconDeviceMobileCheck } from '@tabler/icons-vue';
import { TablerBadge } from '@tak-ps/vue-tabler';

const { t } = useI18n();

defineProps<{
    title?: string
}>();
</script>
