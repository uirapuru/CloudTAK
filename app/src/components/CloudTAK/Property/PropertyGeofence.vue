<template>
    <div class='col-12'>
        <SlideDownHeader
            v-model='expanded'
            :label='t("property.geofence.title")'
        >
            <template #icon>
                <IconFence
                    :size='18'
                    stroke='1'
                    color='#6b7990'
                    class='ms-2 me-1'
                />
            </template>
            <div class='mx-2 py-2'>
                <div class='rounded cloudtak-accent px-2 py-2 user-select-none'>
                    <div class='row g-2'>
                        <div class='col-12'>
                            <TablerToggle
                                :label='t("property.geofence.elevationMonitored")'
                                :model-value='geofence.elevationMonitored ?? false'
                                :disabled='true'
                            />
                        </div>

                        <div
                            v-if='geofence.trigger === "Both" || geofence.trigger === "Entry"'
                            class='col-6 py-2 d-flex align-items-center'
                        >
                            <IconDoorEnter
                                :size='32'
                                stroke='1'
                                class='mx-2'
                            />
                            <span>{{ t('property.geofence.alarmOnEnter') }}</span>
                        </div>
                        <div
                            v-if='geofence.trigger === "Both" || geofence.trigger === "Exit"'
                            class='col-6 py-2 d-flex align-items-center'
                        >
                            <IconDoorExit
                                :size='32'
                                stroke='1'
                                class='mx-2'
                            />
                            <span>{{ t('property.geofence.alarmOnExit') }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </SlideDownHeader>
    </div>
</template>

<script setup lang='ts'>
import { ref } from 'vue';
import SlideDownHeader from '../util/SlideDownHeader.vue';
import { IconFence, IconDoorEnter, IconDoorExit } from '@tabler/icons-vue';
import { TablerToggle } from '@tak-ps/vue-tabler';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
    geofence: {
        elevationMonitored?: boolean;
        tracking?: boolean;
        trigger?: string;
    }
}>();

const expanded = ref(false);
</script>
