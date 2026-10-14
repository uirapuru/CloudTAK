<template>
    <TablerIconButton
        class='favorite-star'
        :title='active ? "Usuń z ulubionych" : "Dodaj do ulubionych"'
        :aria-pressed='active'
        @click.stop.prevent='emit("toggle")'
    >
        <IconStarFilled
            v-if='active'
            class='text-warning'
            :size='20'
        />
        <IconStar
            v-else
            :size='20'
            stroke='1'
        />
    </TablerIconButton>
</template>

<script setup lang='ts'>
import { TablerIconButton } from '@tak-ps/vue-tabler';
import { IconStar, IconStarFilled } from '@tabler/icons-vue';

defineProps<{
    /** The overlay is a favorite */
    active: boolean;
}>();

const emit = defineEmits<{
    toggle: [];
}>();
</script>
