<template>
    <MenuTemplate
        name='New Route'
    >
        <template #default>
            <TablerLoading
                v-if='loading || !config'
                desc='Loading'
            />
            <TablerAlert
                v-else-if='error'
                :err='error'
            />
            <template v-else>
                <div class='my-2'>
                    <TablerEnum
                        v-if='config.providers.length'
                        v-model='routePlan.provider'
                        :disabled='building'
                        label='Routing Provider'
                        :options='config.providers.map(p => p.name)'
                    />
                </div>
                <div
                    v-if='building'
                    class='my-2 route-build-list'
                >
                    <div class='text-secondary small mb-1'>
                        Kliknij mapę, aby dodać kolejny punkt. Ostatni punkt jest celem.
                    </div>
                    <div
                        v-for='(point, index) in buildPoints'
                        :key='index'
                        class='d-flex align-items-center gap-2 py-1 route-build-point'
                    >
                        <span
                            class='badge route-build-label'
                            :class='point.label === "A" || point.label === "B" ? "bg-orange text-white" : "bg-secondary text-white"'
                            v-text='point.label'
                        />
                        <span
                            class='flex-grow-1 small'
                            v-text='point.name'
                        />
                        <button
                            type='button'
                            class='btn btn-sm btn-link text-danger p-0 route-build-remove'
                            title='Usuń punkt'
                            @click='mapStore.draw.removeRouteWaypoint(index)'
                        >
                            <IconX
                                :size='16'
                                stroke='1'
                            />
                        </button>
                    </div>
                </div>
                <template v-else>
                    <div class='my-2'>
                        <SearchBox
                            :key='startKey'
                            label='Start Location'
                            placeholder='Start Location'
                            :autofocus='true'
                            :location-picker='true'
                            :initial-value='startInitialValue'
                            @select='selectStart'
                        />
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-primary my-location mt-2'
                            @click='useMyLocation'
                        >
                            <IconCurrentLocation
                                :size='18'
                                stroke='1'
                                class='me-1'
                            />Moja pozycja
                        </button>
                        <div
                            v-if='locationError'
                            class='text-danger small mt-1'
                            v-text='locationError'
                        />
                    </div>
                    <div
                        v-for='(via, index) in routePlan.via'
                        :key='via.key'
                        class='my-2 d-flex align-items-end gap-2'
                    >
                        <div class='flex-grow-1'>
                            <SearchBox
                                :label='"Punkt pośredni " + (index + 1)'
                                placeholder='Punkt pośredni'
                                :autofocus='false'
                                :location-picker='true'
                                @select='via.value = $event ? { name: $event.name, coordinates: $event.coordinates } : null'
                            />
                        </div>
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-danger mb-1 remove-via'
                            title='Usuń punkt pośredni'
                            @click='removeVia(index)'
                        >
                            <IconX
                                :size='16'
                                stroke='1'
                            />
                        </button>
                    </div>
                    <div class='my-2'>
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-secondary add-via'
                            @click='addVia'
                        >
                            <IconPlus
                                :size='16'
                                stroke='1'
                                class='me-1'
                            />Dodaj punkt pośredni
                        </button>
                    </div>
                    <div class='my-2'>
                        <SearchBox
                            label='End Location'
                            placeholder='End Location'
                            :autofocus='false'
                            :location-picker='true'
                            :initial-value='endInitialValue'
                            @select='routePlan.end = $event ? { name: $event.name, coordinates: $event.coordinates } : null'
                        />
                    </div>
                </template>

                <div class='my-2'>
                    <TablerEnum
                        v-if='modes.length > 0'
                        v-model='routePlan.travelMode'
                        :disabled='building && mapStore.draw.routeBusy'
                        label='Travel Mode'
                        :options='modes.map(m => m.name)'
                    />
                </div>
                <div
                    v-if='isCrossCountry'
                    class='my-2 route-options'
                >
                    <div class='text-secondary small mb-1'>
                        Opcje przełaju
                    </div>
                    <TablerToggle
                        v-model='crossCountry.avoidWetland'
                        class='avoid-wetland'
                        label='Omijaj bagna'
                        :disabled='building && mapStore.draw.routeBusy'
                    />
                    <TablerToggle
                        v-model='crossCountry.avoidStreams'
                        class='avoid-streams'
                        label='Omijaj strumienie i rowy'
                        :disabled='building && mapStore.draw.routeBusy'
                    />
                    <TablerEnum
                        v-model='crossCountry.maxSlope'
                        class='max-slope'
                        label='Największe nachylenie'
                        :options='SLOPE_CHOICES'
                        :disabled='building && mapStore.draw.routeBusy'
                    />
                    <TablerEnum
                        v-model='crossCountry.exposure'
                        class='exposure'
                        label='Ekspozycja'
                        description='Średnia i unikaj prowadzą trasę lasem zamiast przez pola i drogi. Model zna rodzaj terenu z OSM, ale nie gęstość lasu.'
                        :options='Object.keys(EXPOSURE_CHOICES)'
                        :disabled='building && mapStore.draw.routeBusy'
                    />
                </div>
                <div class='my-3'>
                    <button
                        :disabled='!canGenerate'
                        class='btn btn-primary w-100'
                        @click='generateRoute'
                    >
                        Generate Route
                    </button>
                </div>
            </template>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import SearchBox from '../util/SearchBox.vue';
import MenuTemplate from '../util/MenuTemplate.vue';
import {
    TablerEnum,
    TablerToggle,
    TablerAlert,
    TablerLoading,
} from '@tak-ps/vue-tabler';
import { server } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import { IconCurrentLocation, IconPlus, IconX } from '@tabler/icons-vue';
import { waypointLabel } from '../../../base/route-plan.ts';
import type { LngLat, RouteOptions } from '../../../base/route-plan.ts';
import { LocationState } from '../../../utils/events.ts';
import type { Search } from '../../../types.ts';

const router = useRouter();
const route = useRoute();
const mapStore = useMapStore();

const endInitialValue = computed<string>(() => {
    if (!route.query.end) return '';
    const parts = String(route.query.end).split(',').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const [lng, lat] = parts;
        return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    return '';
});

const loading = ref(true);

// Wartość początkowa pola startu; SearchBox czyta ją tylko przy montowaniu,
// więc zmiana klucza wymusza ponowne zamontowanie pola
const startInitialValue = ref('');
const startKey = ref(0);
const locationError = ref('');

type RoutePoint = {
    name: string;
    coordinates: [number, number]
};

const routePlan = ref<{
    provider: string;
    start: null | RoutePoint;
    via: Array<{ key: number; value: null | RoutePoint }>;
    end: null | RoutePoint;
    travelMode: string;
}>({
    provider: '',
    start: null,
    via: [],
    end: null,
    travelMode: ''
});

let viaKey = 0;

// Tryb przełaju dostawcy taklab; tylko on ma opcje trasy
const CROSS_COUNTRY = 'foot_cross_country';
// Pierwsza pozycja = limit usługi terenu, czyli brak dodatkowego ograniczenia
const NO_SLOPE_LIMIT = 'bez limitu (35°)';
const SLOPE_CHOICES = [NO_SLOPE_LIMIT, '25°', '20°', '15°', '10°'];

// Etykieta w formularzu → wartość API; pierwsza = bez kary za teren odsłonięty
const EXPOSURE_CHOICES: Record<string, NonNullable<RouteOptions['exposure']>> = {
    'może być': 'allow',
    'średnia': 'medium',
    'unikaj': 'avoid',
};

const crossCountry = ref({
    avoidWetland: false,
    avoidStreams: false,
    maxSlope: NO_SLOPE_LIMIT,
    exposure: 'może być',
});

const isCrossCountry = computed(() => selectedModeId() === CROSS_COUNTRY);

// Opcje w formacie planu trasy; pomija wartości domyślne
function routeOptions(): RouteOptions | undefined {
    const options: RouteOptions = {};
    if (crossCountry.value.avoidWetland) options.avoid_wetland = true;
    if (crossCountry.value.avoidStreams) options.avoid_streams = true;
    if (crossCountry.value.maxSlope !== NO_SLOPE_LIMIT) options.max_slope_deg = parseInt(crossCountry.value.maxSlope, 10);
    const exposure = EXPOSURE_CHOICES[crossCountry.value.exposure];
    if (exposure && exposure !== 'allow') options.exposure = exposure;
    return Object.keys(options).length ? options : undefined;
}

// Budowanie trasy kliknięciami: start wskazany na mapie, kolejne kliknięcia
// dopisują punkty w edytorze trasy (DrawTool.buildRoute)
const building = ref(false);

const buildPoints = computed(() => {
    const waypoints: LngLat[] = mapStore.draw.routeWaypoints;
    return waypoints.map((w, index) => ({
        label: waypointLabel(index, waypoints.length),
        name: `${w[1].toFixed(5)}, ${w[0].toFixed(5)}`,
    }));
});

const canGenerate = computed(() => {
    // Edytor wie, czy trasa jest policzona (pierwszy odcinek mógł się nie udać)
    if (building.value) return mapStore.draw.canFinish;
    return !!routePlan.value.start
        && !!routePlan.value.end
        && routePlan.value.via.every((via) => via.value !== null);
});

function addVia(): void {
    routePlan.value.via.push({ key: ++viaKey, value: null });
}

function removeVia(index: number): void {
    routePlan.value.via.splice(index, 1);
}

function modeId(name: string): string | undefined {
    for (const m of modes.value) {
        if (m.name === name) return m.id;
    }
    return undefined;
}

function selectedModeId(): string | undefined {
    return modeId(routePlan.value.travelMode);
}

function selectedProviderId(): string | undefined {
    for (const p of config.value?.providers ?? []) {
        if (p.name === routePlan.value.provider) return p.id;
    }
    return undefined;
}

async function selectStart(event: null | (RoutePoint & { source?: string })): Promise<void> {
    routePlan.value.start = event ? { name: event.name, coordinates: event.coordinates } : null;

    // Budowanie kliknięciami tylko ze startem wskazanym na mapie i u dostawcy taklab
    if (!event || event.source !== 'map' || selectedProviderId() !== 'taklab') return;

    await mapStore.draw.buildRoute({
        travelMode: selectedModeId() ?? 'car',
        options: routeOptions(),
        start: [event.coordinates[0], event.coordinates[1]],
        callsign: event.name,
    });
    building.value = true;
}

// Zmiana trybu w czasie budowania liczy trasę od nowa; gdy edytor jej nie przyjmie,
// pole wraca do poprzedniego trybu (powrót trafia tu jeszcze raz, ale tryb edytora się nie zmienił)
watch(() => routePlan.value.travelMode, async (name, previous) => {
    if (!building.value) return;
    const id = modeId(name);
    if (!id) return;
    if (!await mapStore.draw.setRouteTravelMode(id)) {
        routePlan.value.travelMode = previous;
    }
});

// Zmiana opcji w czasie budowania liczy trasę od nowa; odrzuconą cofamy jak tryb
// (obserwujemy kopię, bo przy głębokim obserwatorze obiektu poprzednia wartość to ten sam obiekt)
watch(() => ({ ...crossCountry.value }), async (_current, previous) => {
    if (!building.value) return;
    if (!await mapStore.draw.setRouteOptions(routeOptions())) {
        crossCountry.value = previous;
    }
});

// Anulowanie edytora na pasku dolnym kończy budowanie
watch(() => mapStore.draw.mode, (mode) => {
    if (building.value && mode !== 'route') {
        building.value = false;
        routePlan.value.start = null;
        startInitialValue.value = '';
        startKey.value++;
    }
});

onUnmounted(async () => {
    if (building.value) {
        building.value = false;
        await mapStore.draw.stop();
    }
});

const error = ref<Error | undefined>();
const config = ref<Search["route"]>();

const modes = computed(() => {
    if (!config.value) return [];

    for (const p of config.value.providers) {
        if (p.name === routePlan.value.provider) {
            return p.modes;
        }
    }

    return [];
});

// Tryb jednego dostawcy nie istnieje u drugiego: po zmianie dostawcy
// wybieramy pierwszy tryb nowego (albo żaden)
watch(() => routePlan.value.provider, () => {
    routePlan.value.travelMode = modes.value[0]?.name ?? '';
});

async function useMyLocation(): Promise<boolean> {
    let location;
    try {
        location = await mapStore.worker.profile.location;
    } catch (err) {
        console.error('Nie udało się odczytać pozycji', err);
        locationError.value = 'Pozycja nieznana. Włącz GPS albo ustaw pozycję ręcznie na mapie.';
        return false;
    }

    if (![LocationState.Preset, LocationState.Live].includes(location.source)) {
        locationError.value = 'Pozycja nieznana. Włącz GPS albo ustaw pozycję ręcznie na mapie.';
        return false;
    }

    locationError.value = '';
    routePlan.value.start = { name: 'Moja pozycja', coordinates: [location.coordinates[0], location.coordinates[1]] };
    startInitialValue.value = 'Moja pozycja';
    startKey.value++;
    return true;
}

onMounted(async () => {
    await settings();

    if (!route.query.start) {
        // Automatyczne wywołanie nie pokazuje błędu, gdy pozycji nie ma
        try {
            await useMyLocation();
        } catch (err) {
            console.error('Nie udało się odczytać pozycji', err);
        }
        locationError.value = '';
    }

    if (route.query.end) {
        const parts = String(route.query.end).split(',').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const [lng, lat] = parts;
            routePlan.value.end = {
                name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                coordinates: [lng, lat]
            };
        }
    }
});

async function settings() {
    const res = await server.GET('/api/search');

    try  {
        if (res.error) throw new Error(res.error.message);
        config.value = res.data.route;

        routePlan.value.provider = config.value.providers[0].name;

        if (config.value.providers[0].modes.length > 0) {
            routePlan.value.travelMode = config.value.providers[0].modes[0].name;
        }

        loading.value = false;
    } catch (err) {
        loading.value = false;
        error.value = err instanceof Error ? err : new Error(String(err));
    }
}

async function generateRoute(): Promise<void> {
    if (building.value) {
        const points = buildPoints.value;
        mapStore.draw.setRouteCallsign(`${points[0].name} to ${points[points.length - 1].name}`);
        // building wyłącza obserwator trybu, gdy edytor zapisze trasę i się zamknie
        await mapStore.draw.finish();
        return;
    }

    if (!routePlan.value.start || !routePlan.value.end) {
        return;
    }

    loading.value = true;

    try {
        let provider: string | undefined = undefined;
        let travelMode: string | undefined = undefined;

        if (config.value) {
            for (const p of config.value.providers) {
                if (p.name === routePlan.value.provider) {
                    provider = p.id;
                    break;
                }
            }
        }

        if (routePlan.value.travelMode) {
            for (const m of modes.value) {
                if (m.name === routePlan.value.travelMode) {
                    travelMode = m.id;
                    break;
                }
            }
        }

        const options = travelMode === CROSS_COUNTRY ? routeOptions() : undefined;

        const { data: route, error: reqErr } = await server.GET('/api/search/route', {
            params: {
                query: {
                    start: routePlan.value.start.coordinates.join(','),
                    end: routePlan.value.end.coordinates.join(','),
                    via: routePlan.value.via.length
                        ? routePlan.value.via.map((via) => (via.value as RoutePoint).coordinates.join(',')).join(';')
                        : undefined,
                    callsign: routePlan.value.start.name + ' to ' + routePlan.value.end.name,
                    provider,
                    travelMode,
                    avoidWetland: options?.avoid_wetland,
                    avoidStreams: options?.avoid_streams,
                    maxSlope: options?.max_slope_deg,
                    exposure: options?.exposure,
                }
            }
        });

        if (reqErr) throw new Error(String(reqErr));

        if (route && route.features.length > 0) {
            // @ts-expect-error Feature types are slightly incompatible
            const cot = await mapStore.worker.db.add(route.features[0], {
                authored: true
            });

            if (!cot) throw new Error('Failed to add route');

            cot.flyTo();

            router.push(`/cot/${cot.id}`);
        } else {
            throw new Error('No Route Found');
        }

        loading.value = false;
    } catch (err) {
        loading.value = false;
        throw err;
    }
}

</script>
