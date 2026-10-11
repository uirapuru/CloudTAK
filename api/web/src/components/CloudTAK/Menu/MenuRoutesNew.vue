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
                        label='Routing Provider'
                        :options='config.providers.map(p => p.name)'
                    />
                </div>
                <div class='my-2'>
                    <SearchBox
                        :key='startKey'
                        label='Start Location'
                        placeholder='Start Location'
                        :autofocus='true'
                        :location-picker='true'
                        :initial-value='startInitialValue'
                        @select='routePlan.start = $event || null'
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
                <div class='my-2'>
                    <SearchBox
                        label='End Location'
                        placeholder='End Location'
                        :autofocus='false'
                        :location-picker='true'
                        :initial-value='endInitialValue'
                        @select='routePlan.end = $event || null'
                    />
                </div>

                <div class='my-2'>
                    <TablerEnum
                        v-if='modes.length > 0'
                        v-model='routePlan.travelMode'
                        label='Travel Mode'
                        :options='modes.map(m => m.name)'
                    />
                </div>
                <div class='my-3'>
                    <button
                        :disabled='!routePlan.start || !routePlan.end'
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
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import SearchBox from '../util/SearchBox.vue';
import MenuTemplate from '../util/MenuTemplate.vue';
import {
    TablerEnum,
    TablerAlert,
    TablerLoading,
} from '@tak-ps/vue-tabler';
import { server } from '../../../std.ts';
import { useMapStore } from '../../../stores/map.ts';
import { IconCurrentLocation } from '@tabler/icons-vue';
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

const routePlan = ref<{
    provider: string;
    start: null | {
        name: string;
        coordinates: [number, number]
    };
    end: null | {
        name: string;
        coordinates: [number, number]
    }
    travelMode: string;
}>({
    provider: '',
    start: null,
    end: null,
    travelMode: ''
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

async function useMyLocation(): Promise<boolean> {
    const location = await mapStore.worker.profile.location;

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

        const { data: route, error: reqErr } = await server.GET('/api/search/route', {
            params: {
                query: {
                    start: routePlan.value.start.coordinates.join(','),
                    end: routePlan.value.end.coordinates.join(','),
                    callsign: routePlan.value.start.name + ' to ' + routePlan.value.end.name,
                    provider,
                    travelMode,
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
