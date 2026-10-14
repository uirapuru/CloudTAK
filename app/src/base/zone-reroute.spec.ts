import { describe, expect, it, vi } from 'vitest';
import { lineCrossesPolygon, routesToReroute, routesNearZones, rerouteRoutes } from './zone-reroute.ts';
import type { RouteFeature } from './zone-reroute.ts';

const zone = [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]] as Array<Array<[number, number]>>;

function route(id: string, coordinates: Array<[number, number]>, options?: Record<string, unknown>): RouteFeature {
    return {
        id,
        type: 'Feature',
        properties: {
            id,
            type: 'b-m-r',
            callsign: `Trasa ${id}`,
            stroke: '#ff0000',
            remarks: 'stary opis',
            metadata: {
                taklab_route: {
                    version: 1,
                    mode: 'foot',
                    mode_name: 'Pieszo',
                    waypoints: [coordinates[0], coordinates[coordinates.length - 1]],
                    legs: [{ start: 0, end: coordinates.length - 1, distance_m: 1, duration_s: 1 }],
                    ...(options ? { options } : {}),
                },
            },
        },
        geometry: { type: 'LineString', coordinates },
    };
}

describe('lineCrossesPolygon', () => {
    it('wierzchołek w środku albo odcinek przez strefę to przecięcie', () => {
        expect(lineCrossesPolygon([[20.99, 52.005], [21.005, 52.005]], zone)).toBe(true);
        expect(lineCrossesPolygon([[20.99, 52.005], [21.02, 52.005]], zone)).toBe(true);
    });

    it('trasa obok strefy nie przecina', () => {
        expect(lineCrossesPolygon([[20.99, 52.02], [21.02, 52.02]], zone)).toBe(false);
    });
});

describe('routesToReroute', () => {
    it('bierze trasy z planem przecinające strefę, bez wyłączonego omijania', () => {
        const through = route('a', [[20.99, 52.005], [21.02, 52.005]]);
        const aside = route('b', [[20.99, 52.02], [21.02, 52.02]]);
        const ignoring = route('c', [[20.99, 52.005], [21.02, 52.005]], { ignore_danger_zones: true });
        const noPlan = { ...route('d', [[20.99, 52.005], [21.02, 52.005]]), properties: { id: 'd', type: 'b-m-r' } };
        expect(routesToReroute([through, aside, ignoring, noPlan], zone).map((r) => r.id)).toEqual(['a']);
    });
});

describe('routesNearZones', () => {
    // ok. 0,0045° szerokości = 500 m
    it('bierze trasy do 500 m od starego albo nowego położenia strefy', () => {
        const moved = [[[21.1, 52.1], [21.11, 52.1], [21.11, 52.11], [21.1, 52.11], [21.1, 52.1]]] as Array<Array<[number, number]>>;
        const detour = route('old', [[20.99, 52.013], [21.02, 52.013]]);
        const throughNew = route('new', [[21.09, 52.105], [21.12, 52.105]]);
        const far = route('far', [[20.99, 52.03], [21.02, 52.03]]);
        const ignoring = route('ign', [[20.99, 52.005], [21.02, 52.005]], { ignore_danger_zones: true });
        expect(routesNearZones([detour, throughNew, far, ignoring], [zone, moved]).map((r) => r.id)).toEqual(['old', 'new']);
    });

    it('bez stref nic', () => {
        expect(routesNearZones([route('a', [[20.99, 52.005], [21.02, 52.005]])], [])).toEqual([]);
    });
});

describe('rerouteRoutes', () => {
    it('liczy trasę od nowa przez te same punkty i zachowuje nazwę, kolor i id', async () => {
        const original = route('a', [[20.99, 52.005], [21.02, 52.005]], { avoid_wetland: true });
        const fresh = route('x', [[20.99, 52.005], [21.005, 52.02], [21.02, 52.005]]);
        fresh.properties.remarks = 'nowy opis';
        const plan = vi.fn(async () => fresh);
        const save = vi.fn<(feature: RouteFeature) => Promise<void>>(async () => undefined);

        const result = await rerouteRoutes([original], { plan, save });

        expect(plan).toHaveBeenCalledWith({
            travelMode: 'foot',
            waypoints: [[20.99, 52.005], [21.02, 52.005]],
            options: { avoid_wetland: true },
        });
        const saved = save.mock.calls[0][0];
        expect(saved.id).toBe('a');
        expect(saved.properties.callsign).toBe('Trasa a');
        expect(saved.properties.stroke).toBe('#ff0000');
        expect(saved.properties.remarks).toBe('nowy opis');
        expect(saved.geometry.coordinates).toEqual(fresh.geometry.coordinates);
        expect(result).toEqual({ rerouted: ['Trasa a'], failed: [] });
    });

    it('błąd jednej trasy nie zatrzymuje pozostałych', async () => {
        const plan = vi.fn()
            .mockRejectedValueOnce(new Error('no_path'))
            .mockResolvedValueOnce(route('x', [[20.99, 52.03], [21.02, 52.03]]));
        const save = vi.fn(async () => undefined);
        const result = await rerouteRoutes([route('a', [[20.99, 52.005], [21.02, 52.005]]), route('b', [[20.99, 52.006], [21.02, 52.006]])], { plan, save });
        expect(result).toEqual({ rerouted: ['Trasa b'], failed: [{ name: 'Trasa a', error: 'no_path' }] });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
