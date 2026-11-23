<template>
    <IconCar
        v-if='props.sourceType === "vehicle"'
        :title='t("util.videoLeaseSourceType.vehicle")'
        :size='32'
        stroke='1'
    />
    <IconWalk
        v-else-if='props.sourceType === "personal"'
        :title='t("util.videoLeaseSourceType.bodyCamera")'
        :size='32'
        stroke='1'
    />
    <IconDrone
        v-else-if='props.sourceType === "uas-rotor"'
        :title='t("util.videoLeaseSourceType.uasRotorcraft")'
        :size='32'
        stroke='1'
    />
    <IconHelicopter
        v-else-if='props.sourceType === "rotor"'
        :title='t("util.videoLeaseSourceType.mannedRotorcraft")'
        :size='32'
        stroke='1'
    />
    <IconPlane
        v-else-if='props.sourceType === "fixedwing"'
        :title='t("util.videoLeaseSourceType.fixedWing")'
        :size='32'
        stroke='1'
    />
    <IconPlane
        v-else-if='props.sourceType === "uas-fixedwing"'
        :title='t("util.videoLeaseSourceType.uasFixedWing")'
        :size='32'
        stroke='1'
    />
    <IconDeviceDesktop
        v-else-if='props.sourceType === "screenshare"'
        :title='t("util.videoLeaseSourceType.screenshare")'
        :size='32'
        stroke='1'
    />
    <IconVideo
        v-else
        :title='t("util.videoLeaseSourceType.unknown")'
        :size='32'
        stroke='1'
    />
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import {
    IconVideo,
    IconCar,
    IconWalk,
    IconDrone,
    IconPlane,
    IconHelicopter,
    IconDeviceDesktop,
} from '@tabler/icons-vue';

const { t } = useI18n();

const props = defineProps<{
    sourceType: string
}>();
</script>
