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
import { renderFrustums, drawnGround, groundKey } from '../../../base/sensor-frustum.ts';

const mapStore = useMapStore();
const liveVideo = useLiveVideoStore();

let rendering = false;
let again = false;
let drawnKey = '';

function elevation(lngLat: [number, number]): number | null {
    return drawnGround(mapStore.map, lngLat);
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
            drawnKey = groundKey(liveVideo.cameras, elevation);
            await renderFrustums(liveVideo.cameras, liveVideo.streams, elevation);
        } while (again);
    } catch (err) {
        console.error('Live video: frustum layer failed', err);
    } finally {
        rendering = false;
    }
}

watch(() => [liveVideo.cameras, liveVideo.streams], () => { void draw(); });

/**
 * The ground under a camera is known only once its terrain tiles are loaded
 * (and changes when 3D is switched on or off), so after the map settles the
 * frustums are redrawn when any camera's ground differs from the last draw.
 */
function onIdle(): void {
    if (!liveVideo.cameras.length) return;
    if (groundKey(liveVideo.cameras, elevation) !== drawnKey) void draw();
}

watch(() => liveVideo.count, (count) => {
    mapStore.menu.liveVideoCount.value = count;
}, { immediate: true });

onMounted(() => {
    liveVideo.start();
    mapStore.map.on('idle', onIdle);
    mapStore.map.on('terrain', onIdle);
});

onUnmounted(() => {
    // The map can be gone first when the whole page is torn down
    mapStore._map?.off('idle', onIdle);
    mapStore._map?.off('terrain', onIdle);
    liveVideo.stop();
    mapStore.menu.liveVideoCount.value = 0;
    void renderFrustums([], [], elevation).catch(() => undefined);
});
</script>
