<template>
    <div class='col-12 d-flex align-items-center py-2 px-2 text-muted'>
        <IconInfoSquareRounded
            :size='32'
            stroke='1'
            class='mx-2'
        />
        <div>
            {{ t('util.channelInfo.onlyShown', { label: props.label || t('util.channelInfo.dataSyncs') }) }}
        </div>
    </div>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import {
    IconInfoSquareRounded
} from '@tabler/icons-vue';

const { t } = useI18n();

const props = defineProps({
    label: {
        type: String,
        default: ''
    }
});
</script>
