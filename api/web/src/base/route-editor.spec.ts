import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import RouteEditor, { EDITOR_SOURCE } from './route-editor.ts';
import type { EditorMap, EditorState, Reroute, RouteFirstLeg } from './route-editor.ts';
import type { RoutePlan, LngLat } from './route-plan.ts';
import type { Feature } from '../types.ts';

// Atrapa mapy: 1 stopień = 1000 px, więc 0,001° = 1 px; oś y rośnie w dół
type Handler = (e: Record<string, unknown>) => void;

function fakeMap() {
    const handlers = new Map<string, Handler[]>();
    const sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>();
    const layers = new Set<string>();
    const dragPan = { enabled: true, enable() { this.enabled = true; }, disable() { this.enabled = false; } };

    const map = {
        on: (type: string, fn: Handler) => { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
        off: (type: string, fn: Handler) => { handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn)); },
        addSource: (id: string, spec: { data: unknown }) => {
            const source = { data: spec.data, setData(d: unknown) { this.data = d; } };
            sources.set(id, source);
        },
        getSource: (id: string) => sources.get(id),
        addLayer: (layer: { id: string }) => { layers.add(layer.id); },
        getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
        removeLayer: (id: string) => { layers.delete(id); },
        removeSource: (id: string) => { sources.delete(id); },
        project: (ll: LngLat | { lng: number; lat: number }) => {
            const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
            return { x: lng * 1000, y: -lat * 1000 };
        },
        getCanvas: () => ({ style: { cursor: '' } }),
        dragPan,
    };

    function fire(type: string, lng: number, lat: number) {
        const e = {
            type,
            lngLat: { lng, lat },
            point: { x: lng * 1000, y: -lat * 1000 },
            preventDefault: vi.fn(),
            originalEvent: {},
        };
        for (const fn of handlers.get(type) ?? []) fn(e);
        return e;
    }

    return { map: map as unknown as EditorMap, fire, sources, layers, handlers, dragPan };
}

function state(): EditorState {
    return { busy: ref(false), error: ref(''), waypoints: ref([]), menu: ref(null), summary: ref('') };
}

// Trasa A(21,52) → 1(21.1,52) → B(21.1,52.1): odcinek 0 poziomy, odcinek 1 pionowy
const coordinates = [[21, 52], [21.05, 52], [21.1, 52], [21.1, 52.05], [21.1, 52.1]];
const plan: RoutePlan = {
    version: 1,
    mode: 'foot',
    mode_name: 'Pieszo',
    waypoints: [[21, 52], [21.1, 52], [21.1, 52.1]],
    legs: [
        { start: 0, end: 2, distance_m: 6800, duration_s: 5000 },
        { start: 2, end: 4, distance_m: 11100, duration_s: 8000 },
    ],
};

function routeFeature(p: RoutePlan = plan, coords = coordinates): Feature {
    return {
        id: 'route-1',
        type: 'Feature',
        path: '/',
        properties: { id: 'route-1', type: 'b-m-r', callsign: 'Moja trasa', remarks: 'stary opis', metadata: { taklab_route: p } },
        geometry: { type: 'LineString', coordinates: coords },
    } as unknown as Feature;
}

// Odpowiedź API: linia prosta przez punkty usera, po jednym odcinku między kolejnymi
function apiFeature(waypoints: LngLat[]): Feature {
    const legs = waypoints.slice(1).map((_, i) => ({ start: i, end: i + 1, distance_m: 1000, duration_s: 600 }));
    return {
        id: 'api',
        type: 'Feature',
        path: '/',
        properties: { type: 'b-m-r', callsign: 'Pieszo', remarks: `nowy opis ${waypoints.length}`, metadata: { taklab_route: { ...plan, waypoints, legs } } },
        geometry: { type: 'LineString', coordinates: waypoints.map((w) => [...w]) },
    } as unknown as Feature;
}

function editor(opts: { mode: 'build' | 'edit'; waypoints?: LngLat[]; reroute?: Reroute; first?: RouteFirstLeg }) {
    const fake = fakeMap();
    const s = state();
    const reroute: Reroute = opts.reroute ?? vi.fn(async (body) => apiFeature(body.waypoints));
    const first: RouteFirstLeg = opts.first ?? vi.fn(async (_mode, stops) => apiFeature(stops));
    const instance = new RouteEditor(fake.map, {
        mode: opts.mode,
        travelMode: 'foot',
        feature: opts.mode === 'edit' ? routeFeature() : undefined,
        waypoints: opts.waypoints,
        reroute,
        first,
        state: s,
    });
    instance.start();
    return { ...fake, s, reroute, first, instance };
}

function rendered(sources: ReturnType<typeof fakeMap>['sources']) {
    return (sources.get(EDITOR_SOURCE)?.data as { features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> }).features;
}

async function click(fire: ReturnType<typeof fakeMap>['fire'], lng: number, lat: number) {
    fire('mousedown', lng, lat);
    fire('mouseup', lng, lat);
    await vi.waitFor(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
}

async function drag(fire: ReturnType<typeof fakeMap>['fire'], from: LngLat, to: LngLat) {
    fire('mousedown', from[0], from[1]);
    fire('mousemove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    fire('mousemove', to[0], to[1]);
    fire('mouseup', to[0], to[1]);
    await new Promise((r) => setTimeout(r, 0));
}

describe('RouteEditor - rysowanie', () => {
    it('rysuje linię i tylko punkty usera z etykietami A, 1, B', () => {
        const { sources } = editor({ mode: 'edit' });
        const features = rendered(sources);
        const points = features.filter((f) => f.geometry.type === 'Point');
        expect(points.map((p) => p.properties.label)).toEqual(['A', '1', 'B']);
        expect(features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(1);
    });
});

describe('RouteEditor - tryb budowania (f)', () => {
    it('pierwszy punkt to marker A bez zapytania, drugi liczy trasę, trzeci dopisuje cel', async () => {
        const { fire, sources, first, reroute, s } = editor({ mode: 'build', waypoints: [[21, 52]] });
        expect(rendered(sources).filter((f) => f.geometry.type === 'Point').map((p) => p.properties.label)).toEqual(['A']);
        expect(first).not.toHaveBeenCalled();

        await click(fire, 21.2, 52);
        expect(first).toHaveBeenCalledWith('foot', [[21, 52], [21.2, 52]]);

        await click(fire, 21.2, 52.3);
        expect(reroute).toHaveBeenCalledWith(expect.objectContaining({ first: 1, count: 0, added: 1, waypoints: [[21, 52], [21.2, 52], [21.2, 52.3]] }));
        expect(s.waypoints.value).toEqual([[21, 52], [21.2, 52], [21.2, 52.3]]);
        expect(rendered(sources).filter((f) => f.geometry.type === 'Point').map((p) => p.properties.label)).toEqual(['A', '1', 'B']);
    });

    it('kliknięcie przy linii w budowaniu też dopisuje na koniec', async () => {
        const { fire, reroute } = editor({ mode: 'build', waypoints: [[21, 52]] });
        await click(fire, 21.2, 52);
        await click(fire, 21.1, 52.003);
        expect(reroute).toHaveBeenCalledWith(expect.objectContaining({ added: 1, first: 1, count: 0 }));
    });
});

describe('RouteEditor - tryb edycji', () => {
    it('kliknięcie 40 px od trasy wstawia punkt do najbliższego odcinka (e)', async () => {
        const { fire, reroute } = editor({ mode: 'edit' });
        // 40 px na wschód od pionowego odcinka 1
        await click(fire, 21.14, 52.06);
        expect(reroute).toHaveBeenCalledWith(expect.objectContaining({
            first: 1, count: 1, added: 1,
            waypoints: [[21, 52], [21.1, 52], [21.14, 52.06], [21.1, 52.1]],
        }));
    });

    it('kliknięcie 5 px od linii stawia punkt na linii (c)', async () => {
        const { fire, reroute } = editor({ mode: 'edit' });
        await click(fire, 21.03, 52.005);
        const body = (reroute as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(body.first).toBe(0);
        expect(body.waypoints[1][0]).toBeCloseTo(21.03, 4);
        expect(body.waypoints[1][1]).toBeCloseTo(52, 4);
    });

    it('kliknięcie przy wierzchołku stawia punkt na wierzchołku (c)', async () => {
        const { fire, reroute } = editor({ mode: 'edit' });
        await click(fire, 21.052, 52.003);
        const body = (reroute as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(body.waypoints[1]).toEqual([21.05, 52]);
    });

    it('przeciągnięcie punktu pośredniego przelicza dwa odcinki (a)', async () => {
        const { fire, reroute, dragPan } = editor({ mode: 'edit' });
        fire('mousedown', 21.1, 52);
        expect(dragPan.enabled).toBe(false);
        fire('mousemove', 21.12, 52.01);
        fire('mouseup', 21.15, 52.02);
        await new Promise((r) => setTimeout(r, 0));
        expect(reroute).toHaveBeenCalledWith(expect.objectContaining({
            first: 0, count: 2, added: 0, waypoints: [[21, 52], [21.15, 52.02], [21.1, 52.1]],
        }));
        expect(dragPan.enabled).toBe(true);
    });

    it('przeciągnięcie odcinka tworzy punkt pośredni, a linia stoi w miejscu (d)', async () => {
        const { fire, reroute, sources, dragPan } = editor({ mode: 'edit' });
        fire('mousedown', 21.03, 52.004);
        expect(dragPan.enabled).toBe(false);
        fire('mousemove', 21.03, 52.02);
        const line = rendered(sources).find((f) => f.geometry.type === 'LineString');
        expect(line?.geometry.coordinates).toEqual(coordinates);
        fire('mousemove', 21.03, 52.03);
        fire('mouseup', 21.03, 52.03);
        await new Promise((r) => setTimeout(r, 0));
        expect(reroute).toHaveBeenCalledWith(expect.objectContaining({
            first: 0, count: 1, added: 1, waypoints: [[21, 52], [21.03, 52.03], [21.1, 52], [21.1, 52.1]],
        }));
    });

    it('ruch krótszy niż 4 px po wciśnięciu na linii to kliknięcie', async () => {
        const { fire, reroute } = editor({ mode: 'edit' });
        fire('mousedown', 21.03, 52.004);
        fire('mousemove', 21.032, 52.004);
        fire('mouseup', 21.032, 52.004);
        await new Promise((r) => setTimeout(r, 0));
        const body = (reroute as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(body.waypoints[1][1]).toBeCloseTo(52, 4);
    });

    it('przeciąganie mapy poza trasą nie dodaje punktu', async () => {
        const { reroute, fire, dragPan } = editor({ mode: 'edit' });
        await drag(fire, [21.5, 52.5], [21.6, 52.6]);
        expect(dragPan.enabled).toBe(true);
        expect(reroute).not.toHaveBeenCalled();
    });

    it('wynik zachowuje id i nazwę trasy, bierze nową geometrię, opis i plan', async () => {
        const { fire, instance } = editor({ mode: 'edit' });
        await click(fire, 21.14, 52.06);
        const result = instance.result();
        expect(result?.id).toBe('route-1');
        expect(result?.properties.callsign).toBe('Moja trasa');
        expect(result?.properties.remarks).toBe('nowy opis 4');
        expect((result?.properties.metadata as { taklab_route: RoutePlan }).taklab_route.waypoints).toHaveLength(4);
    });
});

describe('RouteEditor - usuwanie', () => {
    it('kliknięcie markera otwiera menu, usunięcie punktu pośredniego łączy odcinki', async () => {
        const { fire, s, instance, reroute } = editor({ mode: 'edit' });
        await click(fire, 21.1, 52);
        expect(s.menu.value?.index).toBe(1);
        await instance.removeWaypoint(1);
        expect(reroute).toHaveBeenCalledWith(expect.objectContaining({ first: 0, count: 2, added: -1, waypoints: [[21, 52], [21.1, 52.1]] }));
        expect(s.menu.value).toBeNull();
    });

    it('w edycji nie da się zejść poniżej dwóch punktów', async () => {
        const reroute = vi.fn(async (body: Parameters<Reroute>[0]) => apiFeature(body.waypoints));
        const { instance, s } = editor({ mode: 'edit', reroute });
        await instance.removeWaypoint(1);
        await instance.removeWaypoint(0);
        expect(reroute).toHaveBeenCalledTimes(1);
        expect(s.error.value).toMatch(/dwa punkty/);
    });

    it('w budowaniu usunięcie do jednego punktu zdejmuje linię', async () => {
        const { fire, instance, sources } = editor({ mode: 'build', waypoints: [[21, 52]] });
        await click(fire, 21.2, 52);
        await instance.removeWaypoint(1);
        expect(rendered(sources).filter((f) => f.geometry.type === 'LineString')).toHaveLength(0);
        expect(instance.result()).toBeNull();
    });
});

describe('RouteEditor - błędy i blokada', () => {
    it('błąd przeliczenia przywraca punkt i pokazuje komunikat', async () => {
        const reroute = vi.fn(async () => { throw new Error('Brak przejścia między punktami.'); });
        const { fire, s, sources } = editor({ mode: 'edit', reroute });
        await drag(fire, [21.1, 52], [21.3, 52.3]);
        expect(s.error.value).toBe('Brak przejścia między punktami.');
        expect(s.busy.value).toBe(false);
        const points = rendered(sources).filter((f) => f.geometry.type === 'Point');
        expect(points[1].geometry.coordinates).toEqual([21.1, 52]);
    });

    it('w czasie przeliczania kliknięcia nic nie robią', async () => {
        let release: () => void = () => undefined;
        const reroute = vi.fn((body: Parameters<Reroute>[0]) => new Promise<Feature>((resolve) => { release = () => resolve(apiFeature(body.waypoints)); }));
        const { fire, s } = editor({ mode: 'edit', reroute });
        fire('mousedown', 21.14, 52.06);
        fire('mouseup', 21.14, 52.06);
        expect(s.busy.value).toBe(true);
        fire('mousedown', 21.5, 52.5);
        fire('mouseup', 21.5, 52.5);
        release();
        await new Promise((r) => setTimeout(r, 0));
        expect(reroute).toHaveBeenCalledTimes(1);
        expect(s.busy.value).toBe(false);
    });
});

describe('RouteEditor - sprzątanie', () => {
    it('destroy zdejmuje warstwy, źródło i zdarzenia oraz włącza przesuwanie mapy', () => {
        const { instance, layers, sources, handlers, dragPan, fire } = editor({ mode: 'edit' });
        fire('mousedown', 21.1, 52);
        instance.destroy();
        expect(layers.size).toBe(0);
        expect(sources.size).toBe(0);
        expect([...handlers.values()].every((list) => list.length === 0)).toBe(true);
        expect(dragPan.enabled).toBe(true);
    });
});
