<template>
    <span class='d-none' />
</template>

<script setup lang='ts'>
/**
 * taklab: live video on the map - runs the live video store while the map
 * is shown, keeps the Videos menu badge, and draws the camera frustums and
 * the live camera ring in the deck.gl overlay.
 */
import { watch, onMounted, onUnmounted } from 'vue';
import { useMapStore } from '../../../stores/map.ts';
import { useLiveVideoStore } from '../../../stores/live-video.ts';
import { renderFrustums } from '../../../base/sensor-frustum.ts';

const mapStore = useMapStore();
const liveVideo = useLiveVideoStore();

let rendering = false;
let again = false;

function elevation(lngLat: [number, number]): number | null {
    try {
        const value = mapStore.map.queryTerrainElevation(lngLat);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

async function draw(): Promise<void> {
    // One render at a time; a change during a render triggers one more
    if (rendering) {
        again = true;
        return;
    }
    rendering = true;
    try {
        do {
            again = false;
            await renderFrustums(liveVideo.cameras, liveVideo.streams, elevation);
        } while (again);
    } catch (err) {
        console.error('Live video: frustum layer failed', err);
    } finally {
        rendering = false;
    }
}

watch(() => [liveVideo.cameras, liveVideo.streams], () => { void draw(); });

watch(() => liveVideo.count, (count) => {
    mapStore.menu.liveVideoCount.value = count;
}, { immediate: true });

onMounted(() => {
    liveVideo.start();
});

onUnmounted(() => {
    liveVideo.stop();
    mapStore.menu.liveVideoCount.value = 0;
    void renderFrustums([], [], elevation).catch(() => undefined);
});
</script>
