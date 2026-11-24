<template>
    <TablerModal size='lg'>
        <div class='modal-status bg-blue' />
        <button
            type='button'
            class='btn-close'
            :aria-label='t("common.close")'
            @click='emit("close")'
        />
        <div class='modal-header text-body'>
            <div
                class='modal-title'
                v-text='t("map.areaPackage.title", { width: areaSize.width, height: areaSize.height })'
            />
        </div>
        <div class='modal-body'>
            <TablerLoading v-if='loading' />
            <template v-else>
                <label
                    class='form-label'
                    for='area-package-name'
                    v-text='t("map.areaPackage.name")'
                />
                <input
                    id='area-package-name'
                    v-model='name'
                    class='form-control mb-3'
                    maxlength='100'
                >

                <TablerAlert
                    v-if='error'
                    :err='error'
                />

                <div class='area-group'>
                    <div class='area-group__header'>
                        <span
                            class='fw-bold'
                            v-text='t("map.areaPackage.layers")'
                        />
                        <label class='form-check form-check-inline m-0'>
                            <input
                                class='form-check-input'
                                type='checkbox'
                                data-test='group-layers'
                                :checked='allLayersChecked'
                                :disabled='!availableLayers.length'
                                @change='toggleLayers(($event.target as HTMLInputElement).checked)'
                            >
                            <span
                                class='form-check-label'
                                v-text='t("map.areaPackage.all")'
                            />
                        </label>
                    </div>

                    <div
                        v-if='!layers.length'
                        class='text-secondary small'
                        v-text='t("map.areaPackage.noLayers")'
                    />

                    <div
                        v-for='layer in layers'
                        :key='layer.key'
                        class='area-layer'
                        :data-test='`layer-${layer.request.id ?? layer.request.file}`'
                    >
                        <div class='d-flex align-items-center gap-2'>
                            <input
                                v-if='layer.preview?.available'
                                v-model='layer.checked'
                                class='form-check-input m-0'
                                type='checkbox'
                            >
                            <span
                                v-else
                                class='area-layer__dash'
                            >—</span>
                            <span v-text='layer.preview?.name ?? layer.name' />
                        </div>

                        <template v-if='layer.preview?.available'>
                            <ZoomRangeSlider
                                :model-value='layer.zoom'
                                :min='layer.preview.layer_minzoom'
                                :max='layer.preview.layer_maxzoom'
                                :disabled='!layer.checked'
                                @update:model-value='setZoom(layer, $event)'
                            />
                            <div
                                class='text-secondary small'
                                v-text='t("map.areaPackage.tiles", { tiles: layer.preview.tiles.toLocaleString(), size: formatBytes(layer.preview.bytes) })'
                            />
                        </template>
                        <div
                            v-else-if='layer.preview'
                            class='text-secondary small'
                            v-text='t(`map.areaPackage.unavailable.${layer.preview.reason ?? "forbidden"}`)'
                        />
                    </div>
                </div>

                <div
                    v-for='group in groups'
                    :key='group.kind'
                    class='area-group'
                >
                    <div class='area-group__header'>
                        <span
                            class='fw-bold'
                            v-text='t(`map.areaPackage.${group.kind}s`, { count: group.items.length })'
                        />
                        <label class='form-check form-check-inline m-0'>
                            <input
                                class='form-check-input'
                                type='checkbox'
                                :data-test='`group-${group.kind}`'
                                :checked='group.items.length > 0 && group.items.every((f) => checkedFeatures.has(f.id))'
                                :disabled='!group.items.length'
                                @change='toggleGroup(group.kind, ($event.target as HTMLInputElement).checked)'
                            >
                            <span
                                class='form-check-label'
                                v-text='t("map.areaPackage.all")'
                            />
                        </label>
                    </div>
                    <div class='area-group__items'>
                        <label
                            v-for='item in group.items'
                            :key='item.id'
                            class='form-check form-check-inline'
                        >
                            <input
                                class='form-check-input'
                                type='checkbox'
                                :checked='checkedFeatures.has(item.id)'
                                @change='toggleFeature(item.id, ($event.target as HTMLInputElement).checked)'
                            >
                            <span
                                class='form-check-label'
                                v-text='item.title'
                            />
                        </label>
                    </div>
                </div>
            </template>
        </div>
        <div class='modal-footer'>
            <div class='me-auto'>
                <span
                    v-if='overLimit'
                    class='text-danger'
                    v-text='t("map.areaPackage.overLimit", { tiles: totals.tiles.toLocaleString(), limit: limits.tiles.toLocaleString() })'
                />
                <span
                    v-else
                    v-text='t("map.areaPackage.total", { size: formatBytes(totals.bytes) })'
                />
            </div>
            <button
                type='button'
                class='btn btn-secondary'
                @click='emit("close")'
                v-text='t("common.cancel")'
            />
            <button
                type='button'
                class='btn btn-primary'
                data-test='save'
                :disabled='!canSave'
                @click='save'
                v-text='t("map.areaPackage.save")'
            />
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
// taklab: choose what goes into an offline area package (map tiles and objects)
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { distance } from '@turf/distance';
import { TablerAlert, TablerLoading, TablerModal } from '@tak-ps/vue-tabler';
import { std } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import OverlayManager from '../../../base/overlay.ts';
import { profileAssetIdFromUrl } from '../../../utils/offline-tiles.ts';
import type { AreaBounds, AreaFeature, AreaFeatureKind } from '../../../base/taklab-area-features.ts';
import ZoomRangeSlider from './ZoomRangeSlider.vue';

type LayerRequest = { source: 'basemap'; id: number } | { source: 'profile'; file: string };

type PreviewLayer = {
    source: string;
    id?: number;
    file?: string;
    name: string;
    available: boolean;
    reason?: string;
    format: string;
    minzoom: number;
    maxzoom: number;
    layer_minzoom: number;
    layer_maxzoom: number;
    tiles: number;
    bytes: number;
};

type Preview = {
    layers: PreviewLayer[];
    tiles: number;
    bytes: number;
    limits: { tiles: number; bytes: number; features: number };
};

type LayerRow = {
    key: string;
    name: string;
    request: LayerRequest & { id?: number; file?: string };
    checked: boolean;
    zoom: [number, number];
    preview?: PreviewLayer;
};

const { t } = useI18n();
const mapStore = useMapStore();

const props = defineProps<{ bounds: AreaBounds }>();
const emit = defineEmits<{
    close: [];
    created: [pkg: unknown];
}>();

const PREVIEW_DELAY_MS = 300;
const KINDS: AreaFeatureKind[] = ['marker', 'shape', 'route'];

const loading = ref(true);
const saving = ref(false);
const error = ref<Error | undefined>();
const name = ref(defaultName());
const layers = ref<LayerRow[]>([]);
const features = ref<AreaFeature[]>([]);
const checkedFeatures = reactive(new Set<string>());
const limits = ref({ tiles: 100000, bytes: 2147483648, features: 5000 });

let previewTimer: ReturnType<typeof setTimeout> | undefined;

function defaultName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return t('map.areaPackage.defaultName', {
        date: `${pad(now.getDate())}.${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    });
}

const areaSize = computed(() => {
    const [w, s, e, n] = props.bounds;
    const mid = (s + n) / 2;
    const km = (a: [number, number], b: [number, number]) => distance(a, b, { units: 'kilometers' }).toFixed(1).replace('.', ',');
    return {
        width: km([w, mid], [e, mid]),
        height: km([w, s], [w, n]),
    };
});

function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    return `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
}

/** Raster layers on the map now: the basemap, overlays and the user's own files */
function candidateLayers(): LayerRow[] {
    const rows: LayerRow[] = [];

    for (const overlay of OverlayManager.visible()) {
        let request: LayerRequest | undefined;

        if ((overlay.mode === 'basemap' || overlay.mode === 'overlay') && overlay.mode_id) {
            request = { source: 'basemap', id: Number(overlay.mode_id) };
        } else if (overlay.mode === 'profile') {
            const file = profileAssetIdFromUrl(overlay.url);
            if (file) request = { source: 'profile', file };
        }

        if (!request) continue;

        const key = request.source === 'basemap' ? `basemap-${request.id}` : `profile-${request.file}`;
        if (rows.some((r) => r.key === key)) continue;

        rows.push({ key, name: overlay.name, request, checked: true, zoom: [0, 0] });
    }

    return rows;
}

async function preview(withZoom: boolean): Promise<void> {
    const body = {
        bounds: props.bounds,
        layers: layers.value.map((l) => withZoom && l.preview?.available
            ? { ...l.request, minzoom: l.zoom[0], maxzoom: l.zoom[1] }
            : { ...l.request }),
    };

    const res = await std('/api/profile/area-package/preview', { method: 'POST', body }) as Preview;

    limits.value = res.limits;

    res.layers.forEach((p, i) => {
        const row = layers.value[i];
        if (!row) return;

        if (!row.preview && p.available) {
            const zoom = Math.round(mapStore.map.getZoom());
            const low = Math.min(p.layer_maxzoom, Math.max(p.layer_minzoom, zoom - 2));
            const high = Math.max(low, Math.min(p.layer_maxzoom, zoom + 4));
            row.zoom = [low, high];
            row.preview = p;
            // The first preview used the full range of the layer; count the default range
            schedulePreview();
        } else {
            row.preview = p;
        }

        if (!p.available) row.checked = false;
    });
}

function schedulePreview(): void {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        preview(true).catch((err) => {
            error.value = err instanceof Error ? err : new Error(String(err));
        });
    }, PREVIEW_DELAY_MS);
}

function setZoom(layer: LayerRow, zoom: [number, number]): void {
    layer.zoom = zoom;
    schedulePreview();
}

const availableLayers = computed(() => layers.value.filter((l) => l.preview?.available));
const allLayersChecked = computed(() => availableLayers.value.length > 0 && availableLayers.value.every((l) => l.checked));

function toggleLayers(checked: boolean): void {
    for (const layer of availableLayers.value) layer.checked = checked;
}

const groups = computed(() => KINDS.map((kind) => ({
    kind,
    items: features.value.filter((f) => f.kind === kind),
})));

function toggleGroup(kind: AreaFeatureKind, checked: boolean): void {
    for (const item of features.value.filter((f) => f.kind === kind)) {
        if (checked) checkedFeatures.add(item.id);
        else checkedFeatures.delete(item.id);
    }
}

function toggleFeature(id: string, checked: boolean): void {
    if (checked) checkedFeatures.add(id);
    else checkedFeatures.delete(id);
}

const selectedLayers = computed(() => availableLayers.value.filter((l) => l.checked));
const selectedFeatures = computed(() => features.value.filter((f) => checkedFeatures.has(f.id)));

const totals = computed(() => ({
    tiles: selectedLayers.value.reduce((s, l) => s + (l.preview?.tiles ?? 0), 0),
    bytes: selectedLayers.value.reduce((s, l) => s + (l.preview?.bytes ?? 0), 0),
}));

const overLimit = computed(() => totals.value.tiles > limits.value.tiles
    || totals.value.bytes > limits.value.bytes
    || selectedFeatures.value.length > limits.value.features);

const canSave = computed(() => !loading.value
    && !saving.value
    && !overLimit.value
    && name.value.trim().length > 0
    && (selectedLayers.value.length > 0 || selectedFeatures.value.length > 0));

async function save(): Promise<void> {
    if (!canSave.value) return;

    saving.value = true;
    error.value = undefined;

    try {
        const pkg = await std('/api/profile/area-package', {
            method: 'POST',
            body: {
                name: name.value.trim(),
                bounds: props.bounds,
                layers: selectedLayers.value.map((l) => ({ ...l.request, minzoom: l.zoom[0], maxzoom: l.zoom[1] })),
                features: selectedFeatures.value.map((f) => f.feature),
            },
        });

        emit('created', pkg);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        saving.value = false;
    }
}

onMounted(async () => {
    try {
        layers.value = candidateLayers();

        const missions = OverlayManager.visible('mission')
            .map((overlay) => overlay.mode_id)
            .filter((guid): guid is string => !!guid);

        features.value = await mapStore.worker.db.areaFeatures([...props.bounds] as AreaBounds, missions);
        for (const f of features.value) checkedFeatures.add(f.id);

        if (layers.value.length) await preview(false);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        loading.value = false;
    }
});

onUnmounted(() => {
    clearTimeout(previewTimer);
});
</script>

<style scoped>
.area-group {
    border-top: 1px solid var(--tblr-border-color, #3a4859);
    padding: 0.75rem 0;
}

.area-group__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
}

.area-group__items {
    max-height: 9rem;
    overflow-y: auto;
}

.area-layer {
    padding: 0.25rem 0 0.5rem 0;
}

.area-layer__dash {
    width: 1rem;
    text-align: center;
}
</style>
