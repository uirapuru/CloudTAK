<template>
    <TablerModal>
        <div class='modal-header'>
            <div class='modal-title'>
                {{ t('tools.buffer.title') }}
            </div>
            <button
                type='button'
                class='btn-close'
                :aria-label='t("common.close")'
                @click='emit("close")'
            />
        </div>
        <div class='modal-body'>
            <PropertyDistance
                v-model='radius'
                :label='t("tools.buffer.radius")'
                :unit='displayUnit'
                :edit='true'
            />
        </div>
        <div class='modal-footer'>
            <button
                type='button'
                class='btn'
                @click='emit("close")'
            >
                {{ t('common.cancel') }}
            </button>
            <button
                type='button'
                class='btn btn-primary'
                @click='applyBuffer'
            >
                {{ t('tools.buffer.apply') }}
            </button>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import { onMounted, ref } from 'vue';
import { v4 as randomUUID } from 'uuid';
import turfBuffer from '@turf/buffer';
import { TablerModal } from '@tak-ps/vue-tabler';
import { useMapStore } from '../../../stores/map.ts';
import type { Feature } from '../../../types.ts';
import ProfileConfig from '../../../base/profile.ts';
import PropertyDistance from '../Property/PropertyDistance.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
    cotId: string;
}>();

const emit = defineEmits<{
    close: []
}>();

const mapStore = useMapStore();

const radius = ref(0.1);
const displayUnit = ref('mile');

onMounted(async () => {
    const displayDistance = await ProfileConfig.get('display_distance');
    if (displayDistance && displayDistance.value) {
        displayUnit.value = displayDistance.value;
    }
});

async function applyBuffer(): Promise<void> {
    if (radius.value <= 0) return;

    const cotFeat = await mapStore.worker.db.get(props.cotId, { mission: true });
    if (!cotFeat) throw new Error('Cannot find COT to buffer');

    const geom = cotFeat.geometry;
    if (geom.type === 'GeometryCollection') throw new Error('Cannot buffer a GeometryCollection');

    const buffered = turfBuffer(geom, radius.value, { units: 'kilometers' });
    if (!buffered) throw new Error('Buffer operation produced no result');

    const now = new Date();
    const id = randomUUID();

    const ring = buffered.geometry.type === 'Polygon'
        ? buffered.geometry.coordinates[0] as [number, number][]
        : buffered.geometry.coordinates[0][0] as [number, number][];
    const centerLng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const centerLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;

    const feat: Feature = {
        id,
        type: 'Feature',
        path: cotFeat.path || '/',
        properties: {
            ...cotFeat.properties,
            id,
            callsign: `${cotFeat.properties.callsign} (Buffer)`,
            type: 'u-d-f',
            center: [centerLng, centerLat],
            time: now.toISOString(),
            start: now.toISOString(),
        },
        geometry: buffered.geometry
    };

    await mapStore.worker.db.add(feat, { authored: true });
    await mapStore.refresh();

    emit('close');
}
</script>
