<template>
    <div
        v-if='liveVideo.count > 0'
        class='live-video-badge-wrap'
    >
        <button
            type='button'
            class='live-video-badge btn btn-danger btn-sm d-flex align-items-center gap-2'
            :title='t("liveVideo.badgeTitle", { count: liveVideo.count })'
            :aria-expanded='liveVideo.listOpen'
            @click='liveVideo.listOpen = !liveVideo.listOpen'
        >
            <span class='live-video-badge-dot' />
            <span
                class='fw-bold'
                v-text='t("liveVideo.badge", { count: liveVideo.count })'
            />
        </button>

        <div
            v-if='liveVideo.listOpen'
            class='live-video-popover card cloudtak-panel mt-2'
        >
            <div class='card-header d-flex align-items-center py-2'>
                <span
                    class='fw-bold'
                    v-text='t("liveVideo.listTitle")'
                />
                <button
                    type='button'
                    class='btn-close ms-auto'
                    :title='t("liveVideo.close")'
                    @click='liveVideo.listOpen = false'
                />
            </div>
            <div class='card-body p-2'>
                <LiveVideoList @done='liveVideo.listOpen = false' />
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
/**
 * taklab: red "LIVE N" badge on the map while anyone publishes video
 */
import { useI18n } from 'vue-i18n';
import LiveVideoList from './LiveVideoList.vue';
import { useLiveVideoStore } from '../../../stores/live-video.ts';

const { t } = useI18n();
const liveVideo = useLiveVideoStore();
</script>

<style scoped>
.live-video-badge-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: auto;
}

.live-video-badge {
    border-radius: 999px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    letter-spacing: 0.04em;
}

.live-video-badge-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background-color: #fff;
    animation: live-video-badge-pulse 1.5s ease-in-out infinite;
}

.live-video-popover {
    width: min(380px, calc(100vw - 32px));
    max-height: 60vh;
    overflow-y: auto;
}

@keyframes live-video-badge-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}
</style>
