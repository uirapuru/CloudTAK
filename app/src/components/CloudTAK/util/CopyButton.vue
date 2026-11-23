<template>
    <TablerIconButton
        v-if='!copied'
        :title='title || t("util.copyButton.copy")'
        @click.stop.prevent='copy'
    >
        <IconCopy
            :size='size'
            stroke='stroke'
        />
    </TablerIconButton>
    <TablerIconButton
        v-else
        :title='t("util.copyButton.copied")'
        @click.stop.prevent='copy'
    >
        <IconCopyCheck
            :size='size'
            :stroke='String(stroke + 1)'
        />
    </TablerIconButton>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, onUnmounted } from 'vue';
import {
    IconCopy,
    IconCopyCheck
} from '@tabler/icons-vue';
import { Clipboard } from '@capacitor/clipboard';

import {
    TablerIconButton
} from '@tak-ps/vue-tabler'

const { t } = useI18n();

const props = defineProps({
    text: {
        type: [String, Number],
        required: true
    },
    title: {
        type: String,
        default: ''
    },
    size: {
        type: Number,
        default: 32
    },
    stroke: {
        type: Number,
        default: 1
    }
})

const copied = ref(false);
const timeout = ref<ReturnType<typeof setTimeout> | undefined>();

onUnmounted(() => {
    if (timeout.value) {
        clearTimeout(timeout.value);
    }
});

async function copy() {
    await Clipboard.write({ string: String(props.text) });
    copied.value = true;

    timeout.value = setTimeout(() => {
        copied.value = false;
    }, 1000);
}
</script>
