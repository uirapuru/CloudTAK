<template>
    <MenuTemplate
        :name='t("streetPhotos.title")'
        :loading='false'
    >
        <template #buttons>
            <TablerIconButton
                :title='t("streetPhotos.toCentre")'
                @click='moveToCentre'
            >
                <IconFocusCentered
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>
        <template #default>
            <div class='px-2 pt-2 d-flex flex-column gap-2'>
                <TablerAlert
                    v-if='error'
                    :err='error'
                />
                <TablerNone
                    v-else-if='disabled'
                    :label='t("streetPhotos.disabled")'
                    :create='false'
                />

                <div
                    class='street-photo rounded position-relative'
                    data-testid='street-photo'
                >
                    <div
                        v-if='current && current.photo.panorama'
                        class='street-photo-pano'
                        role='img'
                        :aria-label='t("streetPhotos.photoAlt")'
                        :style='panoramaStyle'
                    />
                    <img
                        v-else-if='current'
                        class='street-photo-img'
                        :src='photoSrc(current.photo, "sd")'
                        :alt='t("streetPhotos.photoAlt")'
                        @load='imageLoading = false'
                        @error='imageLoading = false'
                    >
                    <div
                        v-else
                        class='street-photo-empty d-flex align-items-center justify-content-center text-center p-3'
                        v-text='emptyText'
                    />
                    <div
                        v-if='fetching || (current && imageLoading)'
                        class='street-photo-busy'
                    >
                        <TablerLoading :compact='true' />
                    </div>
                </div>

                <div
                    v-if='current'
                    class='small d-flex flex-column gap-1'
                    data-testid='street-photo-info'
                >
                    <div class='d-flex justify-content-between'>
                        <span v-text='t("streetPhotos.taken")' />
                        <span v-text='takenText' />
                    </div>
                    <div class='d-flex justify-content-between'>
                        <span v-text='t("streetPhotos.distance")' />
                        <span v-text='t("streetPhotos.metres", { m: Math.round(current.distance) })' />
                    </div>
                    <div class='d-flex justify-content-between'>
                        <span v-text='t("streetPhotos.direction")' />
                        <span v-text='directionText' />
                    </div>
                    <div class='text-muted'>
                        <span v-text='attributionText' />
                    </div>
                </div>

                <div class='d-flex flex-column gap-1'>
                    <label class='small d-flex justify-content-between'>
                        <span v-text='t("streetPhotos.azimuth")' />
                        <span v-text='`${Math.round(azimuth)}° ${compassName(azimuth)}`' />
                    </label>
                    <input
                        v-model.number='azimuth'
                        type='range'
                        class='form-range'
                        min='0'
                        max='359'
                        step='1'
                        data-testid='street-azimuth'
                    >
                    <label class='small d-flex justify-content-between'>
                        <span v-text='t("streetPhotos.fov")' />
                        <span v-text='`${Math.round(fov)}°`' />
                    </label>
                    <input
                        v-model.number='fov'
                        type='range'
                        class='form-range'
                        :min='MIN_FOV'
                        :max='MAX_FOV'
                        step='1'
                    >
                    <label class='small d-flex justify-content-between'>
                        <span v-text='t("streetPhotos.range")' />
                        <span v-text='t("streetPhotos.metres", { m: Math.round(range) })' />
                    </label>
                    <input
                        v-model.number='range'
                        type='range'
                        class='form-range'
                        min='20'
                        :max='MAX_RANGE_M'
                        step='10'
                    >
                    <div
                        class='small text-muted'
                        v-text='t("streetPhotos.hint")'
                    />
                </div>

                <div
                    class='small text-muted'
                    data-testid='street-photo-count'
                    v-text='truncated ? t("streetPhotos.dotsTruncated", { count: nearby.length }) : t("streetPhotos.dots", { count: nearby.length })'
                />

                <div
                    v-if='ranked.length > 1'
                    class='d-flex flex-column gap-1'
                >
                    <div
                        class='small'
                        v-text='t("streetPhotos.others", { count: ranked.length - 1 })'
                    />
                    <div class='d-flex flex-wrap gap-1'>
                        <button
                            v-for='r in ranked.slice(0, 9)'
                            :key='r.photo.id'
                            type='button'
                            class='street-thumb p-0 border rounded'
                            :class='{ "border-primary border-2": current && r.photo.id === current.photo.id }'
                            :title='thumbTitle(r)'
                            @click='choose(r.photo.id)'
                        >
                            <img
                                :src='photoSrc(r.photo, "thumb")'
                                :alt='thumbTitle(r)'
                                loading='lazy'
                            >
                        </button>
                    </div>
                </div>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
/**
 * taklab: "Widok z ziemi" - an observer with a viewing cone on the map and,
 * in this panel, the street-level photo that best shows what the cone covers.
 * Drag the figure to move, drag the round handle at the cone tip (or the
 * slider) to turn it. Photos come from Panoramax through the CloudTAK server.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Marker } from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { IconFocusCentered } from '@tabler/icons-vue';
import {
    TablerAlert,
    TablerIconButton,
    TablerLoading,
    TablerNone,
} from '@tak-ps/vue-tabler';
import MenuTemplate from '../util/MenuTemplate.vue';
import { std, getRuntimeToken } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import {
    DEFAULT_FOV,
    DEFAULT_RANGE_M,
    MIN_FOV,
    MAX_FOV,
    MAX_RANGE_M,
    DOTS_RADIUS_M,
    bearing,
    conePolygon,
    compass,
    needsRefetch,
    normalizeDeg,
    panoramaWindow,
    photoUrl,
    rankOne,
    restackTarget,
    coneForPhoto,
    rankPhotos,
    photosWithin,
    type LngLat,
    type Observer,
    type RankedPhoto,
    type StreetPhoto,
} from '../../../base/street-photos.ts';

type SearchResult = {
    enabled: boolean;
    truncated: boolean;
    provider: string | null;
    attribution: string | null;
    photos: StreetPhoto[];
};

const SOURCE = 'taklab-street-photos';
const CONE_FILL = 'taklab-street-photos-cone-fill';
const CONE_LINE = 'taklab-street-photos-cone-line';
const LINK_LINE = 'taklab-street-photos-link';
const ALL_POINTS = 'taklab-street-photos-all';
const PHOTO_POINT = 'taklab-street-photos-photo';
const LAYERS = [CONE_FILL, CONE_LINE, LINK_LINE, ALL_POINTS, PHOTO_POINT];
/** Every photo within this radius is fetched and shown as a dot. */
const FETCH_RADIUS_M = DOTS_RADIUS_M;
const DRAG_FETCH_MS = 350;

const { t, locale } = useI18n();
const mapStore = useMapStore();

const position = ref<LngLat>([0, 0]);
const azimuth = ref(0);
const fov = ref(DEFAULT_FOV);
const range = ref(DEFAULT_RANGE_M);

const photos = ref<StreetPhoto[]>([]);
const attribution = ref<string | null>(null);
const truncated = ref(false);
const fetchedAt = ref<LngLat | null>(null);
const fetching = ref(false);
const disabled = ref(false);
const error = ref<Error | undefined>();
const token = ref<string | undefined>();
const chosen = ref<string | null>(null);
const imageLoading = ref(false);
const hdLoaded = ref<string | null>(null);

let observerMarker: Marker | undefined;
let tipMarker: Marker | undefined;
let dragTimer: ReturnType<typeof setTimeout> | undefined;
let fetchSeq = 0;
/** Position of the request in flight, so the end of a drag does not ask twice. */
let inflightAt: LngLat | null = null;

const observer = computed<Observer>(() => ({
    position: position.value,
    azimuth: normalizeDeg(azimuth.value),
    fov: fov.value,
    range: range.value,
}));

const ranked = computed<RankedPhoto[]>(() => rankPhotos(photos.value, observer.value));

/** Dots on the map: every photo within 300 m of the observer. */
const nearby = computed<StreetPhoto[]>(() => photosWithin(photos.value, position.value));

const current = computed<RankedPhoto | null>(() => {
    if (chosen.value) {
        // A dot clicked on the map may be far or look away from the cone.
        const photo = photos.value.find((p) => p.id === chosen.value);
        const pick = photo ? rankOne(photo, observer.value) : null;
        if (pick) return pick;
    }
    return ranked.value[0] || null;
});

const emptyText = computed(() => {
    if (fetching.value) return t('streetPhotos.searching');
    if (disabled.value) return t('streetPhotos.disabled');
    if (photos.value.length) return t('streetPhotos.noneInCone');
    return t('streetPhotos.none');
});

const takenText = computed(() => {
    const at = current.value?.photo.taken_at;
    if (!at) return '—';
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? at : date.toLocaleDateString(locale.value, { year: 'numeric', month: 'long', day: 'numeric' });
});

const directionText = computed(() => {
    const r = current.value;
    if (!r) return '';
    if (r.photo.panorama) return t('streetPhotos.panorama');
    return t('streetPhotos.offset', { az: Math.round(r.heading), off: Math.round(r.offset) });
});

const attributionText = computed(() => {
    const p = current.value?.photo;
    const parts = [p?.author ? t('streetPhotos.author', { name: p.author }) : null, p?.license, attribution.value || 'Panoramax'];
    return parts.filter(Boolean).join(' · ');
});

const panoramaStyle = computed(() => {
    const r = current.value;
    if (!r) return {};
    const win = panoramaWindow(r.photo.azimuth, r.heading, fov.value);
    const src = hdLoaded.value === r.photo.id ? photoSrc(r.photo, 'hd') : photoSrc(r.photo, 'sd');
    // The image is scaled so that the window fills the box; repeat-x wraps the seam.
    const scale = 100 / win.width;
    // Left edge of the image so that the point at `centre` lands in the middle of the box.
    const offsetPx = `calc(50cqw - ${win.centre * scale}cqw)`;
    return {
        backgroundImage: `url("${src}")`,
        backgroundSize: `${scale}cqw auto`,
        backgroundPositionX: offsetPx,
        backgroundPositionY: '50%',
        backgroundRepeat: 'repeat-x',
    };
});

function compassName(deg: number): string {
    return compass(deg, t('streetPhotos.compass').split(','));
}

function photoSrc(photo: StreetPhoto, size: 'thumb' | 'sd' | 'hd'): string {
    return photoUrl(photo, size, token.value);
}

function thumbTitle(r: RankedPhoto): string {
    return `${Math.round(r.distance)} m · ${r.photo.panorama ? '360°' : `${Math.round(r.heading)}°`}`;
}

/** Set when the cone is moved onto a photo, so that the watcher below keeps the choice. */
let keepChoice = false;

/**
 * Clicking a photo (dot on the map or thumbnail) moves the observer to where
 * it was taken and turns the cone into the photo's frame.
 */
function choose(id: string): void {
    const photo = photos.value.find((p) => p.id === id);
    if (!photo) return;
    const cone = coneForPhoto(photo, observer.value);
    // The watcher runs only when the cone really turns or widens.
    keepChoice = cone.azimuth !== azimuth.value || cone.fov !== fov.value;
    chosen.value = id;
    azimuth.value = cone.azimuth;
    fov.value = cone.fov;
    moveObserver(cone.position);
    keepInView(cone.position);
    void fetchPhotos();
}

/** Pans the map when the observer lands near the edge of the screen or off it. */
function keepInView(at: LngLat): void {
    const map = mapStore.map as unknown as MapLibreMap;
    const p = map.project(at);
    const canvas = map.getCanvas();
    const margin = 80;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (p.x < margin || p.y < margin || p.x > w - margin || p.y > h - margin) {
        map.easeTo({ center: at, duration: 400 });
    }
}

/** Full-size panorama in the background: the crop of the small one is blurry. */
function preloadPanorama(r: RankedPhoto | null): void {
    if (!r || !r.photo.panorama || hdLoaded.value === r.photo.id) return;
    const id = r.photo.id;
    const img = new Image();
    img.onload = () => {
        if (current.value?.photo.id === id) hdLoaded.value = id;
    };
    img.src = photoSrc(r.photo, 'hd');
}

watch(nearby, () => draw());

watch(() => current.value?.photo.id, () => {
    imageLoading.value = Boolean(current.value && !current.value.photo.panorama);
    preloadPanorama(current.value);
    draw();
});

// Turning the cone by hand drops a photo picked from the list.
watch([azimuth, fov, range], () => {
    if (keepChoice) keepChoice = false;
    else chosen.value = null;
    placeTip();
    draw();
});

async function fetchPhotos(force = false): Promise<void> {
    const at = position.value;
    if (!force && !needsRefetch(fetchedAt.value, at)) return;
    if (!force && inflightAt && !needsRefetch(inflightAt, at)) return;
    inflightAt = at;
    const seq = ++fetchSeq;
    fetching.value = true;
    error.value = undefined;
    try {
        const url = `/api/street-photos?lon=${at[0].toFixed(6)}&lat=${at[1].toFixed(6)}&radius=${FETCH_RADIUS_M}`;
        const res = await std(url) as SearchResult;
        if (seq !== fetchSeq) return;
        disabled.value = !res.enabled;
        attribution.value = res.attribution;
        truncated.value = res.truncated;
        photos.value = res.photos;
        fetchedAt.value = at;
    } catch (err) {
        if (seq !== fetchSeq) return;
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        if (seq === fetchSeq) {
            fetching.value = false;
            inflightAt = null;
        }
    }
}

function scheduleFetch(): void {
    if (dragTimer) return;
    dragTimer = setTimeout(() => {
        dragTimer = undefined;
        void fetchPhotos();
    }, DRAG_FETCH_MS);
}

function geojson(): FeatureCollection {
    const features: Feature[] = [{
        type: 'Feature',
        properties: { kind: 'cone' },
        geometry: { type: 'Polygon', coordinates: [conePolygon(observer.value)] },
    }];
    for (const p of nearby.value) {
        features.push({
            type: 'Feature',
            properties: { kind: 'all', id: p.id, panorama: p.panorama },
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        });
    }
    const r = current.value;
    if (r) {
        const at: LngLat = [r.photo.lon, r.photo.lat];
        features.push({
            type: 'Feature',
            properties: { kind: 'link' },
            geometry: { type: 'LineString', coordinates: [position.value, at] },
        }, {
            type: 'Feature',
            properties: { kind: 'photo' },
            geometry: { type: 'Point', coordinates: at },
        });
    }
    return { type: 'FeatureCollection', features };
}

function ensureLayers(map: MapLibreMap): void {
    if (!map.getSource(SOURCE)) {
        map.addSource(SOURCE, { type: 'geojson', data: geojson() });
    }
    if (!map.getLayer(CONE_FILL)) {
        map.addLayer({
            id: CONE_FILL,
            type: 'fill',
            source: SOURCE,
            filter: ['==', ['get', 'kind'], 'cone'],
            paint: { 'fill-color': '#f59f00', 'fill-opacity': 0.25 },
        });
    }
    if (!map.getLayer(CONE_LINE)) {
        map.addLayer({
            id: CONE_LINE,
            type: 'line',
            source: SOURCE,
            filter: ['==', ['get', 'kind'], 'cone'],
            paint: { 'line-color': '#f59f00', 'line-width': 2 },
        });
    }
    if (!map.getLayer(LINK_LINE)) {
        map.addLayer({
            id: LINK_LINE,
            type: 'line',
            source: SOURCE,
            filter: ['==', ['get', 'kind'], 'link'],
            paint: { 'line-color': '#1c7ed6', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
    }
    if (!map.getLayer(ALL_POINTS)) {
        map.addLayer({
            id: ALL_POINTS,
            type: 'circle',
            source: SOURCE,
            filter: ['==', ['get', 'kind'], 'all'],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 18, 4.5],
                'circle-color': '#1c7ed6',
                'circle-opacity': 0.75,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': ['case', ['get', 'panorama'], 2, 1],
            },
        });
    }
    if (!map.getLayer(PHOTO_POINT)) {
        map.addLayer({
            id: PHOTO_POINT,
            type: 'circle',
            source: SOURCE,
            filter: ['==', ['get', 'kind'], 'photo'],
            paint: {
                'circle-radius': 8,
                'circle-color': '#1c7ed6',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 3,
            },
        });
    }
}

/**
 * CloudTAK orders overlays itself (OverlayManager.applyOrder) and puts the
 * basemap over layers added before it: measured on public 26 XI 2026, the
 * cone and dots sat under the basemap. They are kept right under the CoT
 * markers, as the history layers are.
 */
function restack(map: MapLibreMap): void {
    const target = restackTarget(map.getLayersOrder(), LAYERS);
    if (target === null) return;
    for (const id of LAYERS) if (map.getLayer(id)) map.moveLayer(id, target);
}

function draw(): void {
    if (!mapStore._map) return;
    const map = mapStore.map as unknown as MapLibreMap;
    try {
        ensureLayers(map);
        restack(map);
        (map.getSource(SOURCE) as GeoJSONSource).setData(geojson());
    } catch (err) {
        // The style may be reloading (basemap change); styledata draws again.
        console.warn('Street photos: draw postponed', err);
    }
}

function onDotClick(e: { features?: Array<{ properties?: Record<string, unknown> }> }): void {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === 'string') choose(id);
}

function onDotEnter(): void {
    mapStore.map.getCanvas().style.cursor = 'pointer';
}

function onDotLeave(): void {
    mapStore.map.getCanvas().style.cursor = '';
}

function onStyleData(): void {
    if (!mapStore._map) return;
    const map = mapStore.map as unknown as MapLibreMap;
    if (!map.getSource(SOURCE)) {
        // A new style (basemap change) dropped our source; add it once it is ready.
        if (map.isStyleLoaded()) draw();
        return;
    }
    // Overlays loaded or reordered after us; moving only when out of place
    // keeps the styledata it fires from looping.
    try {
        restack(map);
    } catch (err) {
        console.warn('Street photos: restack', err);
    }
}

/** The turning handle stands a fixed distance on screen from the figure, whatever the zoom and cone length. */
const HANDLE_PX = 70;

function handlePosition(): LngLat {
    const map = mapStore.map as unknown as MapLibreMap;
    const at = map.project(position.value);
    const rad = (normalizeDeg(azimuth.value) - map.getBearing()) * Math.PI / 180;
    const p = map.unproject([at.x + Math.sin(rad) * HANDLE_PX, at.y - Math.cos(rad) * HANDLE_PX]);
    return [p.lng, p.lat];
}

function placeTip(): void {
    if (!mapStore._map) return;
    tipMarker?.setLngLat(handlePosition());
}

function figureElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'taklab-street-observer';
    el.title = t('streetPhotos.dragFigure');
    el.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">'
        + '<circle cx="12" cy="12" r="11" fill="#f59f00" stroke="#fff" stroke-width="2"/>'
        + '<circle cx="12" cy="7.5" r="2.4" fill="#fff"/>'
        + '<path d="M8.5 19v-5.2a3.5 3.5 0 0 1 7 0V19z" fill="#fff"/></svg>';
    return el;
}

function tipElement(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'taklab-street-tip';
    el.title = t('streetPhotos.dragTip');
    return el;
}

function moveObserver(at: LngLat): void {
    position.value = at;
    observerMarker?.setLngLat(at);
    placeTip();
    draw();
}

function moveToCentre(): void {
    const c = mapStore.map.getCenter();
    moveObserver([c.lng, c.lat]);
    chosen.value = null;
    void fetchPhotos(true);
}

onMounted(async () => {
    token.value = await getRuntimeToken();
    const map = mapStore.map;
    const c = map.getCenter();
    position.value = [c.lng, c.lat];
    // Look the way the map is turned.
    azimuth.value = normalizeDeg(Math.round(map.getBearing()));

    observerMarker = new Marker({ element: figureElement(), draggable: true })
        .setLngLat(position.value)
        .addTo(map);
    observerMarker.on('drag', () => {
        const p = observerMarker!.getLngLat();
        position.value = [p.lng, p.lat];
        placeTip();
        draw();
        scheduleFetch();
    });
    observerMarker.on('dragend', () => {
        if (dragTimer) {
            clearTimeout(dragTimer);
            dragTimer = undefined;
        }
        chosen.value = null;
        void fetchPhotos();
    });

    tipMarker = new Marker({ element: tipElement(), draggable: true })
        .setLngLat(handlePosition())
        .addTo(map);
    tipMarker.on('drag', () => {
        const p = tipMarker!.getLngLat();
        azimuth.value = Math.round(bearing(position.value, [p.lng, p.lat]));
        chosen.value = null;
        draw();
    });
    tipMarker.on('dragend', placeTip);
    map.on('move', placeTip);

    map.on('styledata', onStyleData);
    map.on('click', ALL_POINTS, onDotClick);
    map.on('mouseenter', ALL_POINTS, onDotEnter);
    map.on('mouseleave', ALL_POINTS, onDotLeave);
    draw();
    await fetchPhotos(true);
});

onUnmounted(() => {
    if (dragTimer) clearTimeout(dragTimer);
    observerMarker?.remove();
    tipMarker?.remove();
    const map = mapStore._map;
    if (!map) return;
    map.off('styledata', onStyleData);
    map.off('click', ALL_POINTS, onDotClick);
    map.off('mouseenter', ALL_POINTS, onDotEnter);
    map.off('mouseleave', ALL_POINTS, onDotLeave);
    map.getCanvas().style.cursor = '';
    map.off('move', placeTip);
    try {
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    } catch (err) {
        console.warn('Street photos: cleanup', err);
    }
});
</script>

<style>
.taklab-street-observer {
    cursor: grab;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}

.taklab-street-tip {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid #f59f00;
    cursor: grab;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
</style>

<style scoped>
.street-photo {
    container-type: inline-size;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #111;
    overflow: hidden;
}

.street-photo-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.street-photo-pano {
    width: 100%;
    height: 100%;
}

.street-photo-empty {
    width: 100%;
    height: 100%;
    color: #bbb;
}

.street-photo-busy {
    position: absolute;
    top: 6px;
    right: 6px;
}

.street-thumb {
    width: 64px;
    height: 48px;
    overflow: hidden;
    background: #111;
}

.street-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
</style>
