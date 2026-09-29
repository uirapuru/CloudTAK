<template>
    <MenuTemplate
        :name='featureTitle'
        :none='!feature'
    >
        <template #buttons>
            <TablerIconButton
                v-if='feature'
                title='Zoom To'
                @click='zoomTo'
            >
                <IconZoomPan
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerIconButton
                v-if='overlay && ["basemap", "overlay"].includes(overlay.mode) && overlay.actions.feature.includes("fetch")'
                title='Cut to Marker'
                @click='cutFeature'
            >
                <IconScissors
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerIconButton
                v-if='mode === "default"'
                title='Raw View'
                @click='mode = "raw"'
            >
                <IconCode
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>

            <TablerIconButton
                v-else
                title='Default View'
                @click='mode = "default"'
            >
                <IconX
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
        </template>

        <template v-if='feature'>
            <template v-if='mode === "default"'>
                <div class='col-12 px-2 py-2'>
                    <Coordinate v-model='center' />
                </div>

                <div class='col-12 px-2 pb-2'>
                    <div class='col-12'>
                        <IconBlockquote
                            :size='18'
                            stroke='1'
                            color='#6b7990'
                            class='ms-2 me-1'
                        />
                        <label class='subheader user-select-none'>Remarks</label>
                    </div>
                    <div
                        v-if='htmlDescription'
                        class='mx-2'
                    >
                        <CopyField
                            :model-value='htmlDescription'
                            :display='htmlDisplay'
                            :rows='2'
                            mode='text'
                        />
                    </div>
                    <div
                        v-else
                        class='table-responsive rounded mx-2'
                    >
                        <table class='table card-table table-hover table-vcenter datatable'>
                            <thead>
                                <tr>
                                    <th>Key</th>
                                    <th>Value</th>
                                </tr>
                            </thead>
                            <tbody class='cloudtak-accent'>
                                <template v-if='Object.keys(rows).length'>
                                    <tr
                                        v-for='prop of Object.keys(rows)'
                                        :key='prop'
                                    >
                                        <td v-text='prop' />
                                        <td>
                                            <a
                                                v-if='typeof rows[prop] === "string" && (rows[prop] as string).startsWith("http")'
                                                :href='rows[prop] as string'
                                                target='_blank'
                                                v-text='rows[prop]'
                                            />
                                            <span
                                                v-else
                                                v-text='rows[prop]'
                                            />
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div
                    v-if='liveRef'
                    class='col-12 px-3 pb-3'
                >
                    <TablerLoading
                        v-if='detailLoading'
                        desc='Pobieranie szczegółów'
                    />
                    <div
                        v-if='detailError'
                        class='text-danger small mb-2'
                        v-text='detailError'
                    />
                    <template v-if='photo'>
                        <a
                            v-if='photo.link'
                            class='live-photo d-block'
                            :href='photo.link'
                            target='_blank'
                            rel='noopener'
                        >
                            <img
                                :src='photo.src'
                                loading='lazy'
                                style='max-width: 100%'
                                alt=''
                            >
                        </a>
                        <img
                            v-else
                            class='live-photo d-block'
                            :src='photo.src'
                            loading='lazy'
                            style='max-width: 100%'
                            alt=''
                        >
                        <div
                            class='small mb-2'
                            v-text='photo.credit'
                        />
                    </template>
                    <template v-if='detail?.route'>
                        <button
                            type='button'
                            class='live-route btn btn-outline-secondary btn-sm'
                            @click='toggleRoute'
                            v-text='routeToggleLabel(detail, routeVisible)'
                        />
                        <div
                            v-if='detail.route.properties?.label'
                            class='small text-secondary mt-1'
                            v-text='detail.route.properties.label'
                        />
                    </template>
                </div>
            </template>
            <template v-else-if='mode === "raw"'>
                <pre v-text='feature' />
            </template>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useMapStore } from '../../../stores/map.ts';
import type { LngLatLike, MapGeoJSONFeature } from 'maplibre-gl';
import type { Feature } from 'geojson';
import pointOnFeature from '@turf/point-on-feature';
import Handlebars from 'handlebars';
import { server, getRuntimeToken } from '../../../std.ts';
import { liveFeatureTitle, visibleProperties } from '../../../base/live.ts';
import { fetchDetail, liveFeatureRef, RouteToggle, routeToggleLabel, safeHttpUrl, type LiveDetail } from '../../../base/live-detail.ts';
import MenuTemplate from '../util/MenuTemplate.vue';
import Coordinate from '../util/Coordinate.vue';
import CopyField from '../util/CopyField.vue';
import { cutOverlayFeature, getFeatureOverlay } from '../util/featureCut.ts';
import { featureHtmlDescription, proxyHtmlImages } from '../util/proxyImages.ts';
import {
    TablerIconButton,
    TablerLoading
} from '@tak-ps/vue-tabler';
import {
    IconX,
    IconScissors,
    IconZoomPan,
    IconBlockquote,
    IconCode
} from '@tabler/icons-vue';

const mapStore = useMapStore();

const props = defineProps<{
    feat?: Feature | MapGeoJSONFeature
}>();

const feature = computed(() => {
    if (props.feat) return props.feat;
    return mapStore.viewedFeature;
})

const mode = ref('default');
const token = ref<string | null | undefined>(undefined);

onMounted(async () => {
    token.value = (await getRuntimeToken()) ?? null;
});

const overlay = computed(() => getFeatureOverlay(feature.value));

const titleTemplate = ref<string | null>(null);

watch(overlay, async (ov) => {
    titleTemplate.value = null;
    if (!ov || !ov.mode_id || !['basemap', 'overlay'].includes(ov.mode)) return;

    const { data } = await server.GET('/api/basemap/{:basemapid}', {
        params: { path: { ':basemapid': Number(ov.mode_id) } }
    });

    if (data && typeof data === 'object' && 'title' in data && data.title) {
        titleTemplate.value = data.title;
    }
}, { immediate: true });

const tableProperties = computed(() => visibleProperties(feature.value?.properties as Record<string, unknown> | undefined));

// Live overlay features with _detail: extra rows, photo and route fetched on demand
const liveRef = computed(() => liveFeatureRef(feature.value));
const detail = ref<LiveDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const routeToggle = new RouteToggle();
const routeVisible = ref(false);
let detailRequest = 0;

// The store getter throws before the map is initialised; teardown must never throw
function currentMap() {
    try {
        return mapStore.map;
    } catch {
        return null;
    }
}

function hideRoute() {
    routeVisible.value = false;
    const map = currentMap();
    if (!map) return;
    try {
        routeToggle.hide(map);
    } catch (err) {
        console.error('Failed to remove live route', err);
    }
}

function toggleRoute() {
    const map = currentMap();
    if (!map) return;
    if (routeToggle.visible) {
        hideRoute();
    } else if (detail.value?.route) {
        routeToggle.show(map, detail.value.route);
        routeVisible.value = true;
    }
}

// Photo URLs come from third-party APIs: only http(s) may reach href/src
const photo = computed(() => {
    const raw = detail.value?.photo;
    if (!raw) return null;
    const src = safeHttpUrl(raw.src);
    if (!src) return null;
    return {
        src,
        link: safeHttpUrl(raw.link),
        credit: typeof raw.credit === 'string' ? raw.credit : '',
    };
});

watch(feature, async (feat) => {
    // A route always belongs to the feature it was shown for
    hideRoute();
    detail.value = null;
    detailError.value = '';
    const request = ++detailRequest;

    const target = liveFeatureRef(feat);
    if (!target) {
        detailLoading.value = false;
        return;
    }

    detailLoading.value = true;
    try {
        const body = await fetchDetail(target.layer, target.id);
        if (request !== detailRequest) return;
        detail.value = body;
        if (body.error) detailError.value = body.error;
    } catch (err) {
        if (request !== detailRequest) return;
        detailError.value = err instanceof Error ? err.message : String(err);
    } finally {
        if (request === detailRequest) detailLoading.value = false;
    }
}, { immediate: true });

onBeforeUnmount(() => {
    detailRequest++;
    hideRoute();
});

const rows = computed(() => ({
    ...tableProperties.value,
    ...visibleProperties(detail.value?.properties),
}));

const featureTitle = computed(() => {
    if (!feature.value) return 'No Name';
    const props = feature.value.properties || {};

    if (titleTemplate.value) {
        try {
            let tmpl = titleTemplate.value;
            // Bare property name (e.g. "callsign") => wrap as handlebars expression
            if (/^[a-zA-Z0-9_]+$/.test(tmpl)) {
                tmpl = `{{${tmpl}}}`;
            }
            const result = Handlebars.compile(tmpl)(props);
            if (result && result.trim().length > 0) return result;
        } catch {
            // Fall through to default
        }
    }

    return props.name || props.callsign || liveFeatureTitle(props) || 'No Name';
});

const center = computed(() => {
    if (!feature.value) return [0, 0];
    return pointOnFeature(feature.value).geometry.coordinates;
});

const htmlDescription = computed(() => featureHtmlDescription(feature.value?.properties));

const htmlDisplay = computed(() => {
    // Empty until the token is read so images are never requested without it
    if (token.value === undefined || !htmlDescription.value) return '';
    return proxyHtmlImages(htmlDescription.value, token.value);
});

async function cutFeature() {
    await cutOverlayFeature(mapStore, feature.value);
}

function zoomTo() {
    mapStore.map.flyTo({
        center: center.value as LngLatLike,
        zoom: 14
    })
}
</script>
