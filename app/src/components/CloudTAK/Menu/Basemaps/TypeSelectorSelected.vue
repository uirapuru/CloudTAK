<template>
    <div class='col-12'>
        <StandardItem class='d-flex align-items-center gap-3 px-3 py-3'>
            <div class='d-flex align-items-center justify-content-center rounded-circle bg-black bg-opacity-25 p-2'>
                <component
                    :is='config.icon'
                    :size='28'
                    stroke='1.5'
                />
            </div>

            <div>
                <div class='fw-semibold d-flex align-items-center gap-2'>
                    {{ t(`basemaps.types.${type}.label`) }}
                    <TablerBadge
                        v-if='config.beta'
                        class='rounded-pill small'
                        background-color='rgba(255, 171, 0, 0.15)'
                        border-color='rgba(255, 171, 0, 0.35)'
                        text-color='#c98500'
                    >
                        {{ t('basemaps.common.beta') }}
                    </TablerBadge>
                </div>
                <div class='small text-white-50'>
                    {{ t(`basemaps.types.${type}.description`) }}
                </div>
            </div>

            <div class='ms-auto'>
                <button
                    type='button'
                    class='btn btn-sm btn-secondary'
                    @click='emit("change-type")'
                >
                    {{ t('basemaps.common.changeType') }}
                </button>
            </div>
        </StandardItem>
    </div>
</template>

<script setup lang='ts'>
import StandardItem from '../../util/StandardItem.vue';
import { TablerBadge } from '@tak-ps/vue-tabler';
import type { BasemapSourceType } from './types.ts';
import { BasemapTypeConfig } from './types.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
    type: BasemapSourceType;
}>();

const emit = defineEmits<{
    'change-type': [];
}>();

const config = BasemapTypeConfig[props.type];
</script>