<template>
    <div class='live-video-list d-flex flex-column gap-2'>
        <div
            v-if='!liveVideo.supported'
            class='text-secondary small'
            v-text='t("liveVideo.notSupported")'
        />
        <div
            v-else-if='!liveVideo.streams.length'
            class='text-secondary small'
            v-text='t("liveVideo.none")'
        />
        <div
            v-for='stream in liveVideo.streams'
            :key='stream.path'
            class='live-video-row d-flex align-items-center gap-2'
            :data-path='stream.path'
        >
            <span class='live-video-dot' />
            <div class='d-flex flex-column flex-grow-1 overflow-hidden'>
                <div
                    class='fw-bold text-truncate'
                    v-text='streamLabel(stream)'
                />
                <div class='text-secondary small d-flex flex-wrap gap-2'>
                    <span
                        v-if='age(stream)'
                        :title='t("liveVideo.duration")'
                        v-text='age(stream)'
                    />
                    <span
                        v-if='streamResolution(stream)'
                        :title='t("liveVideo.resolution")'
                        v-text='streamResolution(stream)'
                    />
                    <span
                        v-if='bitrate(stream)'
                        :title='t("liveVideo.bitrate")'
                        v-text='bitrate(stream)'
                    />
                </div>
                <div
                    v-if='failed === stream.path'
                    class='text-red small'
                    v-text='t("liveVideo.watchFailed", { user: streamLabel(stream) })'
                />
            </div>
            <TablerIconButton
                v-if='liveVideo.liveCameras.has(stream.path)'
                :title='t("liveVideo.showOnMap")'
                @click='showOnMap(stream.path)'
            >
                <IconMapPin
                    :size='22'
                    stroke='1'
                />
            </TablerIconButton>
            <button
                type='button'
                class='btn btn-sm btn-danger'
                @click='watch(stream)'
                v-text='t("liveVideo.watch")'
            />
        </div>
    </div>
</template>

<script setup lang='ts'>
/**
 * taklab: list of live streams (map badge and the Videos menu)
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { TablerIconButton } from '@tak-ps/vue-tabler';
import { IconMapPin } from '@tabler/icons-vue';
import { useLiveVideoStore } from '../../../stores/live-video.ts';
import {
    streamAge,
    streamLabel,
    streamResolution,
    formatBitrate,
    formatDuration,
    type LiveVideoStream,
} from '../../../base/live-video.ts';

const emit = defineEmits<{
    (e: 'done'): void;
}>();

const { t, locale } = useI18n();
const router = useRouter();
const liveVideo = useLiveVideoStore();

const now = ref(Date.now());
const failed = ref<string | null>(null);
let tick: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
    tick = setInterval(() => { now.value = Date.now(); }, 1000);
});

onUnmounted(() => {
    if (tick) clearInterval(tick);
});

function age(stream: LiveVideoStream): string {
    return formatDuration(streamAge(stream, now.value));
}

function bitrate(stream: LiveVideoStream): string {
    return formatBitrate(stream.tech?.bitrate_kbps, locale.value);
}

async function watch(stream: LiveVideoStream): Promise<void> {
    failed.value = null;
    if (await liveVideo.watch(stream.path)) {
        emit('done');
    } else {
        failed.value = stream.path;
    }
}

function showOnMap(path: string): void {
    const id = liveVideo.showOnMap(path);
    if (id) {
        router.push(`/cot/${id}`);
        emit('done');
    }
}
</script>

<style scoped>
.live-video-dot {
    width: 10px;
    height: 10px;
    min-width: 10px;
    border-radius: 50%;
    background-color: #dc2626;
    animation: live-video-pulse 1.5s ease-in-out infinite;
}

@keyframes live-video-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
}
</style>
