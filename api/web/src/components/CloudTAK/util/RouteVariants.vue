<template>
    <TablerModal size='xl'>
        <div class='modal-status bg-blue' />
        <button
            type='button'
            class='btn-close'
            aria-label='Close'
            @click='emit("close")'
        />
        <div class='modal-header text-body'>
            <div class='modal-title'>
                Warianty trasy
            </div>
        </div>
        <div class='modal-body text-body'>
            <TablerLoading v-if='loading' />
            <template v-else>
                <TablerAlert
                    v-if='error'
                    :err='error'
                />
                <template v-else>
                    <div
                        v-if='intermediate'
                        class='text-secondary mb-2'
                    >
                        Warianty łączą start z celem i pomijają punkty pośrednie.
                    </div>
                    <div
                        v-if='!variants.length'
                        class='text-secondary'
                    >
                        Nie ma wariantów wyraźnie innych niż trasa.
                    </div>
                    <div
                        v-else
                        class='table-responsive'
                    >
                        <table class='table table-sm'>
                            <thead>
                                <tr>
                                    <th>Wariant</th>
                                    <th>Długość</th>
                                    <th>Czas</th>
                                    <th>Osłona</th>
                                    <th>Odsłonięte</th>
                                    <th>Widoczność ze wzgórz</th>
                                    <th>Przejścia przez drogi</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for='row in rows'
                                    :key='row.label'
                                >
                                    <td>
                                        <span
                                            v-if='row.color'
                                            class='me-1'
                                            :style='{ color: row.color }'
                                        >&#9632;</span>{{ row.label }}
                                    </td>
                                    <td>{{ row.length }}</td>
                                    <td>{{ row.duration }}</td>
                                    <td>{{ row.concealed }}</td>
                                    <td>{{ row.exposed }}</td>
                                    <td>{{ row.observed }}</td>
                                    <td>{{ row.crossings }}</td>
                                    <td class='text-end'>
                                        <button
                                            v-if='row.index !== undefined'
                                            class='btn btn-sm btn-primary add-variant'
                                            :disabled='added.has(row.index)'
                                            @click='addVariant(row.index)'
                                        >
                                            {{ added.has(row.index) ? 'Dodano' : 'Dodaj na mapę' }}
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </template>
            </template>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type * as maplibregl from 'maplibre-gl';
import { TablerModal, TablerAlert, TablerLoading } from '@tak-ps/vue-tabler';
import type { Feature } from '../../../types.ts';
import { std } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import type { RoutePlan } from '../../../base/route-plan.ts';
import { collectThreats } from '../../../base/route-threats.ts';
import type { ThreatSource } from '../../../base/route-threats.ts';

const SOURCE = 'route-variants-preview';
const LAYER = 'route-variants-preview-line';
const COLORS = ['#e8590c', '#7048e8'];
const NAMES = ['B', 'C'];
const NONE = '—';

type PreviewMap = Pick<maplibregl.Map, 'addSource' | 'getSource' | 'removeSource' | 'addLayer' | 'getLayer' | 'removeLayer'>;

const props = defineProps<{ feature: Feature }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const mapStore = useMapStore();
const map = mapStore.map as unknown as PreviewMap;

const loading = ref(true);
const error = ref<Error | null>(null);
const variants = ref<Feature[]>([]);
const added = ref<Set<number>>(new Set());

// Plan czytamy z metadanych bez dopasowania do geometrii: obiekt przeszedł już
// readRoutePlan w CoTView, a warianty przychodzą prosto z API.
function planOf(feature: Feature): RoutePlan | null {
    const metadata = feature.properties.metadata as { taklab_route?: RoutePlan } | undefined;
    return metadata && metadata.taklab_route ? metadata.taklab_route : null;
}

const currentPlan = planOf(props.feature);
const intermediate = computed(() => !!currentPlan && currentPlan.waypoints.length > 2);

function formatLength(plan: RoutePlan): string {
    const meters = plan.legs.reduce((sum, leg) => sum + leg.distance_m, 0);
    return (meters / 1000).toFixed(1).replace('.', ',') + ' km';
}

function formatDuration(plan: RoutePlan): string {
    const minutes = Math.round(plan.legs.reduce((sum, leg) => sum + leg.duration_s, 0) / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

function percent(ratio: number | undefined): string {
    return ratio === undefined ? NONE : Math.round(ratio * 100) + '%';
}

function describe(plan: RoutePlan | null, label: string, color?: string, index?: number) {
    const analysis = plan && plan.analysis;
    return {
        label, color, index,
        length: plan ? formatLength(plan) : NONE,
        duration: plan ? formatDuration(plan) : NONE,
        concealed: percent(analysis && analysis.cover ? analysis.cover.concealed : undefined),
        exposed: percent(analysis && analysis.cover ? analysis.cover.exposed : undefined),
        observed: percent(analysis ? analysis.observed_ratio : undefined),
        crossings: analysis && analysis.danger ? String(analysis.danger.filter((d) => d.kind === 'road_crossing').length) : NONE,
    };
}

const rows = computed(() => [
    describe(currentPlan, 'A (obecna)'),
    ...variants.value.map((v, i) => describe(planOf(v), NAMES[i], COLORS[i], i)),
]);

function drawPreview(): void {
    map.addSource(SOURCE, {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: variants.value.map((v, i) => ({ ...v, properties: { color: COLORS[i] } })),
        },
    } as maplibregl.GeoJSONSourceSpecification);
    map.addLayer({
        id: LAYER,
        type: 'line',
        source: SOURCE,
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [2, 1] },
    });
}

function removePreview(): void {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

async function addVariant(index: number): Promise<void> {
    const variant = variants.value[index];
    try {
        await mapStore.worker.db.add({
            ...variant,
            id: crypto.randomUUID(),
            properties: {
                ...variant.properties,
                callsign: `${props.feature.properties.callsign} – wariant ${NAMES[index]}`,
                stroke: COLORS[index],
            },
        } as Feature, { authored: true });
        added.value = new Set(added.value).add(index);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

onMounted(async () => {
    try {
        if (!currentPlan) throw new Error('Trasa nie ma planu taklab.');
        const threats = await collectThreats(mapStore.worker.db as unknown as ThreatSource, currentPlan.waypoints);
        const geometry = props.feature.geometry as { coordinates: number[][] };
        const result = await std('/api/search/route/variants', {
            method: 'POST',
            body: {
                provider: 'taklab',
                travelMode: currentPlan.mode,
                waypoints: currentPlan.waypoints,
                coordinates: geometry.coordinates,
                options: currentPlan.options,
                threats,
                count: 2,
            },
        }) as { features: Feature[] };
        variants.value = result.features;
        if (variants.value.length) drawPreview();
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loading.value = false;
    }
});

onUnmounted(removePreview);
</script>
