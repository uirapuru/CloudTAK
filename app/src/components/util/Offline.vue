<template>
    <div class='card-body d-flex flex-column align-items-center justify-content-center py-4'>
        <IconCloudOff
            :size='48'
            stroke='1'
            class='text-muted mb-3'
        />
        <h3 class='text-center mb-2'>
            {{ t('shared.offline.title') }}
        </h3>
        <p class='text-center text-muted mb-0'>
            {{ t('shared.offline.requiresNetwork') }}
            <br>
            {{ t('shared.offline.checkConnection') }}
        </p>
    </div>
</template>

<script setup lang='ts'>
import {
    IconCloudOff
} from '@tabler/icons-vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>
