<template>
    <PropertyStatusStrip>
        <StatusDot
            :status='active ? "Success" : "Unknown"'
            :title='active ? t("property.coreEntityStatus.activeLabel") : t("property.coreEntityStatus.endedLabel")'
        />
        <TablerBadge
            v-if='priority !== "none"'
            :background-color='badge.background'
            :border-color='badge.border'
            :text-color='badge.text'
        >
            {{ badge.label }}
        </TablerBadge>
        <button
            v-if='edit'
            type='button'
            class='btn btn-sm ms-auto flex-shrink-0'
            @click='emit("update:active", !active)'
        >
            <IconPlayerStop
                v-if='active'
                :size='16'
                stroke='1.5'
                class='me-1'
            />
            <IconPlayerPlay
                v-else
                :size='16'
                stroke='1.5'
                class='me-1'
            />
            {{ active ? t("property.coreEntityStatus.end") : t("property.coreEntityStatus.reactivate") }}
        </button>
    </PropertyStatusStrip>
</template>

<script setup lang='ts'>
/**
 * PropertyCoreEntityStatus - the one-line status strip under the Event
 * header: whether it is active and its priority
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { TablerBadge } from '@tak-ps/vue-tabler';
import { IconPlayerStop, IconPlayerPlay } from '@tabler/icons-vue';
import StatusDot from '../../util/StatusDot.vue';
import PropertyStatusStrip from '../util/PropertyStatusStrip.vue';
import { priorityBadge } from '../../../utils/priority.ts';

const props = defineProps<{
    active: boolean;
    priority: string;
    edit?: boolean;
}>();

const emit = defineEmits<{
    (e: 'update:active', value: boolean): void
}>();

const { t } = useI18n();

const badge = computed(() => priorityBadge(props.priority));
</script>
