<template>
    <TablerModal>
        <div class='modal-status bg-red' />
        <button
            type='button'
            class='btn-close'
            :aria-label='t("common.close")'
            @click='$emit("close")'
        />
        <div class='modal-header text-body'>
            <div class='d-flex align-items-center'>
                <IconInfoSquare
                    :size='28'
                    stroke='1'
                />
                <span class='mx-2'>{{ t('util.warnChannels.title') }}</span>
            </div>
        </div>
        <div class='modal-body text-body'>
            <p>{{ t('util.warnChannels.basis') }}</p>

            <p>{{ t('util.warnChannels.noActive') }}</p>

            <p>{{ t('util.warnChannels.recommended') }}</p>

            <div class='d-flex align-items-center'>
                <div class='ms-auto btn-list'>
                    <button
                        class='btn btn-primary'
                        @click='selectChannels'
                    >
                        {{ t('util.warnChannels.selectChannels') }}
                    </button>
                </div>
            </div>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
    TablerModal,
} from '@tak-ps/vue-tabler';
import {
    IconInfoSquare,
} from '@tabler/icons-vue';

const { t } = useI18n();

const router = useRouter();
const emit = defineEmits([ 'close' ]);

function selectChannels() {
    emit('close');
    router.push('/menu/channels');
}
</script>
