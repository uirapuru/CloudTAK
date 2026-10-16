import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShapeMover, { translateGeometry, translateFeature, HOLD_MS } from './shape-move.ts';
import type { MovableFeature } from './shape-move.ts';

type Handler = (e: Record<string, unknown>) => void;

function fakeMap() {
    const handlers = new Map<string, Handler[]>();
    const sources = new Map<string, { data: unknown; setData(d: unknown): void }>();
    const layers = new Set<string>();
    return {
        handlers, sources, layers,
        dragPan: { enable: vi.fn(), disable: vi.fn() },
        canvas: { style: { cursor: '' } },
        on(type: string, fn: Handler) { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
        off(type: string, fn: Handler) { handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn)); },
        getCanvas() { return this.canvas; },
        getSource(id: string) { return sources.get(id); },
        addSource(id: string, src: { data: unknown }) {
            const source = { data: src.data, setData(d: unknown) { source.data = d; } };
            sources.set(id, source);
        },
        removeSource(id: string) { sources.delete(id); },
        getLayer(id: string) { return layers.has(id) ? { id } : undefined; },
        addLayer(layer: { id: string }) { layers.add(layer.id); },
        removeLayer(id: string) { layers.delete(id); },
        fire(type: string, e: Record<string, unknown>) { for (const h of handlers.get(type) ?? []) h(e); },
    };
}

const square: MovableFeature = {
    id: 'sq',
    type: 'Feature',
    properties: { id: 'sq', callsign: 'Prostokąt', center: [21.005, 52.005] },
    geometry: { type: 'Polygon', coordinates: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]] },
};

const at = (x: number, y: number, lng: number, lat: number) => ({
    point: { x, y }, lngLat: { lng, lat }, originalEvent: { preventDefault: vi.fn() }, preventDefault: vi.fn(),
});

describe('translateGeometry', () => {
    it('przesuwa każdy punkt wielokąta o różnicę długości i szerokości', () => {
        expect(translateGeometry(square.geometry, 0.1, -0.2).coordinates[0][0]).toEqual([21.1, 51.8]);
    });
});

describe('translateFeature', () => {
    const plan = {
        version: 1, mode: 'foot', mode_name: 'Pieszo',
        waypoints: [[21, 52], [21.02, 52.02]],
        legs: [{ start: 0, end: 2, distance_m: 1, duration_s: 1 }],
        analysis: { elevation: [1, 2, 3] },
    };
    const route: MovableFeature = {
        id: 'r', type: 'Feature',
        properties: { id: 'r', type: 'b-m-r', metadata: { other: 1, taklab_route: plan } },
        geometry: { type: 'LineString', coordinates: [[21, 52, 5], [21.01, 52.01, 5], [21.02, 52.02, 5]] },
    };

    it('przesuwa punkty planu o to samo co wierzchołki, zostawia odcinki i zdejmuje analizę', () => {
        const moved = translateFeature(route, 0.1, -0.2);
        const movedPlan = (moved.properties.metadata as { taklab_route: Record<string, unknown> }).taklab_route;
        const geometry = translateGeometry(route.geometry, 0.1, -0.2);
        expect(moved.geometry).toEqual(geometry);
        expect(movedPlan.waypoints).toEqual([geometry.coordinates[0].slice(0, 2), geometry.coordinates[2].slice(0, 2)]);
        expect(movedPlan.legs).toEqual(plan.legs);
        expect(movedPlan).not.toHaveProperty('analysis');
        expect((moved.properties.metadata as Record<string, unknown>).other).toBe(1);
    });

    it('nie zmienia figury wejściowej', () => {
        translateFeature(route, 0.1, -0.2);
        expect(plan.waypoints).toEqual([[21, 52], [21.02, 52.02]]);
        expect(plan).toHaveProperty('analysis');
    });

    it('figura bez planu: tylko geometria', () => {
        const moved = translateFeature(square, 0.1, 0.1);
        expect(moved.properties).toBe(square.properties);
    });

    it('ShapeMover zapisuje trasę z przesuniętym planem', async () => {
        vi.useFakeTimers();
        const map = fakeMap();
        const commit = vi.fn<(id: string, feature: MovableFeature) => Promise<void>>(async () => undefined);
        const mover = new ShapeMover(map as never, { pick: async () => structuredClone(route), commit });
        try {
            map.fire('mousedown', at(100, 100, 21.005, 52.005));
            await vi.advanceTimersByTimeAsync(HOLD_MS);
            map.fire('mousemove', at(150, 80, 21.105, 52.105));
            map.fire('mouseup', at(150, 80, 21.105, 52.105));
            await vi.runAllTimersAsync();
            const moved = commit.mock.calls[0][1];
            const waypoints = (moved.properties.metadata as { taklab_route: { waypoints: number[][] } }).taklab_route.waypoints;
            expect(waypoints[0][0]).toBeCloseTo(21.1);
            expect(waypoints[0][1]).toBeCloseTo(52.1);
            expect(waypoints[1][0]).toBeCloseTo(21.12);
        } finally {
            mover.destroy();
            vi.useRealTimers();
        }
    });
});

describe('ShapeMover', () => {
    let map: ReturnType<typeof fakeMap>;
    let pick: ReturnType<typeof vi.fn<(point: { x: number; y: number }) => Promise<MovableFeature | null>>>;
    let commit: ReturnType<typeof vi.fn<(id: string, feature: MovableFeature) => Promise<void>>>;
    let onStart: ReturnType<typeof vi.fn<(feature: MovableFeature) => void>>;
    let mover: ShapeMover;

    beforeEach(() => {
        vi.useFakeTimers();
        map = fakeMap();
        pick = vi.fn(async () => structuredClone(square) as MovableFeature | null);
        commit = vi.fn(async () => undefined);
        onStart = vi.fn(() => undefined);
        mover = new ShapeMover(map as never, { pick, commit, onStart });
    });

    afterEach(() => {
        mover.destroy();
        vi.useRealTimers();
    });

    async function hold() {
        map.fire('mousedown', at(100, 100, 21.005, 52.005));
        await vi.advanceTimersByTimeAsync(HOLD_MS);
    }

    it('po przytrzymaniu 1 s przesuwa figurę i zapisuje ją tam, gdzie ją upuszczono', async () => {
        await hold();
        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'sq' }));
        expect(map.dragPan.disable).toHaveBeenCalled();
        expect(map.sources.has('shape-move')).toBe(true);

        map.fire('mousemove', at(150, 80, 21.105, 52.105));
        map.fire('mouseup', at(150, 80, 21.105, 52.105));
        await vi.runAllTimersAsync();

        expect(commit).toHaveBeenCalledTimes(1);
        const [id, moved] = commit.mock.calls[0] as [string, MovableFeature];
        expect(id).toBe('sq');
        expect(moved.geometry.coordinates[0][0][0]).toBeCloseTo(21.1);
        expect(moved.geometry.coordinates[0][0][1]).toBeCloseTo(52.1);
        expect(map.sources.has('shape-move')).toBe(false);
        expect(map.dragPan.enable).toHaveBeenCalled();
    });

    it('kliknięcie zaraz po upuszczeniu jest połykane, następne już nie', async () => {
        await hold();
        map.fire('mouseup', at(150, 80, 21.105, 52.105));
        expect(mover.consumeClick()).toBe(true);
        expect(mover.consumeClick()).toBe(false);
    });

    it('puszczenie przed 1 s nic nie robi', async () => {
        map.fire('mousedown', at(100, 100, 21.005, 52.005));
        await vi.advanceTimersByTimeAsync(HOLD_MS - 500);
        map.fire('mouseup', at(100, 100, 21.005, 52.005));
        await vi.advanceTimersByTimeAsync(1000);
        expect(onStart).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(mover.consumeClick()).toBe(false);
    });

    it('ruch przed upływem 1 s to zwykłe przesuwanie mapy', async () => {
        map.fire('mousedown', at(100, 100, 21.005, 52.005));
        map.fire('mousemove', at(130, 100, 21.02, 52.005));
        await vi.advanceTimersByTimeAsync(HOLD_MS);
        expect(onStart).not.toHaveBeenCalled();
        expect(map.dragPan.disable).not.toHaveBeenCalled();
    });

    it('przytrzymanie poza figurą do edycji nic nie robi', async () => {
        pick.mockResolvedValueOnce(null);
        await hold();
        expect(onStart).not.toHaveBeenCalled();
    });

    it('Escape przerywa przesuwanie bez zapisu', async () => {
        await hold();
        map.fire('mousemove', at(150, 80, 21.105, 52.105));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        map.fire('mouseup', at(150, 80, 21.105, 52.105));
        await vi.runAllTimersAsync();
        expect(commit).not.toHaveBeenCalled();
        expect(map.sources.has('shape-move')).toBe(false);
    });

    it('dwa palce nie zaczynają przytrzymania', async () => {
        map.fire('touchstart', { ...at(100, 100, 21.005, 52.005), originalEvent: { touches: [{}, {}] } });
        await vi.advanceTimersByTimeAsync(HOLD_MS);
        expect(onStart).not.toHaveBeenCalled();
    });
});
