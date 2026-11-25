<template>
    <teleport to='body'>
        <div
            v-if='liveVideo.toasts.length'
            class='toast-container position-fixed d-flex flex-column gap-2 live-video-toasts'
            :style='`
                bottom: ${mapStore.toastOffset.y}px;
                right: ${mapStore.toastOffset.x}px;
            `'
        >
            <div
                v-for='toast in liveVideo.toasts'
                :key='toast.id'
                class='toast show'
                :class='`live-video-toast-${toast.kind}`'
                role='alert'
                aria-live='assertive'
                aria-atomic='true'
            >
                <div class='toast-header'>
                    <span class='me-2 d-flex'>
                        <IconVideo
                            v-if='toast.kind === "start"'
                            :size='22'
                            stroke='1'
                            class='text-red'
                        />
                        <IconVideoOff
                            v-else
                            :size='22'
                            stroke='1'
                        />
                    </span>
                    <strong
                        class='me-auto'
                        v-text='toast.kind === "start" ? t("liveVideo.toast.started", { user: toast.label }) : t("liveVideo.toast.ended", { user: toast.label })'
                    />
                    <button
                        type='button'
                        class='ms-2 btn-close'
                        :title='t("common.close")'
                        @click='liveVideo.dismissToast(toast.id)'
                    />
                </div>
                <div
                    v-if='toast.kind === "start"'
                    class='toast-body d-flex justify-content-end py-2'
                >
                    <button
                        type='button'
                        class='btn btn-sm btn-danger'
                        @click='watch(toast)'
                        v-text='t("liveVideo.watch")'
                    />
                </div>
            </div>
        </div>
    </teleport>
</template>

<script setup lang='ts'>
/**
 * taklab: "stream started / ended" toasts, in the corner and style of the
 * CloudTAK notification toasts, with a Watch button the stored
 * notifications cannot carry.
 */
import { useI18n } from 'vue-i18n';
import { IconVideo, IconVideoOff } from '@tabler/icons-vue';
import { useMapStore } from '../../../stores/map.ts';
import { useLiveVideoStore, type LiveVideoToast } from '../../../stores/live-video.ts';

const { t } = useI18n();
const mapStore = useMapStore();
const liveVideo = useLiveVideoStore();

async function watch(toast: LiveVideoToast): Promise<void> {
    liveVideo.dismissToast(toast.id);
    if (!await liveVideo.watch(toast.path)) {
        liveVideo.listOpen = true;
    }
}
</script>

<style scoped>
.live-video-toasts {
    z-index: 1090;
}

.live-video-toast-start {
    border-left: 4px solid #dc2626;
}
</style>
