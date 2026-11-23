<template>
    <div
        class='col-12 d-flex py-2 px-2 align-items-center user-select-none'
        :class='{
            "justify-content-center": !props.button
        }'
    >
        <template v-if='props.type === "Channels"'>
            <IconAlertCircle
                :size='32'
                stroke='2'
                color='red'
                class='mx-2'
            />

            <div class='text-red'>
                {{ t('util.emptyInfo.noChannels') }}
            </div>

            <div
                v-if='props.button'
                class='ms-auto'
            >
                <TablerIconButton
                    :title='t("util.emptyInfo.channelSelection")'
                    @click='router.push("/menu/channels")'
                >
                    <IconAffiliate
                        :size='32'
                        stroke='1'
                    />
                </TablerIconButton>
            </div>
        </template>
        <template v-else-if='props.type === "Missions"'>
            <IconAlertCircle
                :size='32'
                stroke='2'
                class='mx-2'
            />

            <div class='text-red'>
                {{ t('util.emptyInfo.noMissions') }}
            </div>
        </template>
    </div>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
    IconAffiliate,
    IconAlertCircle
} from '@tabler/icons-vue';
import {
    TablerIconButton
} from '@tak-ps/vue-tabler';

const { t } = useI18n();

const router = useRouter();

const props = defineProps({
    type: {
        type: String,
        default: 'Channels'
    },
    button: {
        type: Boolean,
        default: true
    }
})
</script>
