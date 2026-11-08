<template>
    <FloatingPane
        :uid='uid'
        :padded='false'
        @close='emit("close")'
    >
        <template #header>
            <div
                class='text-sm text-truncate'
                style='width: calc(100% - 100px);'
                v-text='pane && pane.name ? pane.name : "Video"'
            />
        </template>

        <iframe
            v-if='pane && pane.config.url'
            :src='String(pane.config.url)'
            title='Video'
            class='h-100 w-100'
            style='border: 0;'
            allow='autoplay; encrypted-media; fullscreen; picture-in-picture'
            allowfullscreen
            referrerpolicy='strict-origin-when-cross-origin'
            sandbox='allow-scripts allow-same-origin allow-presentation'
        />
    </FloatingPane>
</template>

<script setup lang='ts'>
import { computed } from 'vue'
import { useFloatStore } from '../../../stores/float.ts';
import FloatingPane from './FloatingPane.vue';

const floatStore = useFloatStore();

const props = defineProps({
    uid: {
        type: String,
        required: true
    }
});

const emit = defineEmits(['close']);

const pane = computed(() => floatStore.panes.get(props.uid));
</script>
