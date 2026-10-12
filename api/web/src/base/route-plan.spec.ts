import { describe, expect, it } from 'vitest';
import {
    readRoutePlan,
    nearestOnRoute,
    moveChange,
    insertChange,
    appendChange,
    removeChange,
    waypointLabel,
    preserveRoutePlan,
} from './route-plan.ts';
import type { RoutePlan } from './route-plan.ts';

// Trasa A → 1 → B wzdłuż równoleżnika 52 i południka 21.2:
// odcinek 0: (21,52) → (21.1,52) → (21.2,52); odcinek 1: (21.2,52) → (21.2,52.1) → (21.2,52.2)
const coordinates = [[21, 52], [21.1, 52], [21.2, 52], [21.2, 52.1], [21.2, 52.2]];
const plan: RoutePlan = {
    version: 1,
    mode: 'foot',
    mode_name: 'Pieszo',
    waypoints: [[21, 52], [21.2, 52], [21.2, 52.2]],
    legs: [
        { start: 0, end: 2, distance_m: 13700, duration_s: 9000 },
        { start: 2, end: 4, distance_m: 22200, duration_s: 16000 },
    ],
};

function route(properties: Record<string, unknown> = { type: 'b-m-r', metadata: { taklab_route: plan } }) {
    return { properties, geometry: { type: 'LineString' as const, coordinates } };
}

describe('readRoutePlan', () => {
    it('czyta ważny plan', () => {
        expect(readRoutePlan(route())).toEqual(plan);
    });

    it('odrzuca brak planu, obcą geometrię i plan niezgodny z linią', () => {
        expect(readRoutePlan(route({ type: 'b-m-r' }))).toBeNull();
        expect(readRoutePlan(route({ type: 'b-m-r', metadata: {} }))).toBeNull();
        expect(readRoutePlan({ properties: { metadata: { taklab_route: plan } }, geometry: { type: 'Point', coordinates: [21, 52] } })).toBeNull();
        const short = { ...plan, legs: [plan.legs[0], { ...plan.legs[1], end: 3 }] };
        expect(readRoutePlan(route({ type: 'b-m-r', metadata: { taklab_route: short } }))).toBeNull();
        expect(readRoutePlan(route({ type: 'b-m-r', metadata: { taklab_route: { ...plan, version: 2 } } }))).toBeNull();
        expect(readRoutePlan(route({ type: 'b-m-r', metadata: { taklab_route: { ...plan, waypoints: plan.waypoints.slice(0, 2) } } }))).toBeNull();
    });
});

describe('nearestOnRoute', () => {
    it('wybiera odcinek najbliższy kliknięciu', () => {
        // obok drugiego odcinka, na wschód od południka 21.2
        const hit = nearestOnRoute(plan, coordinates, [21.25, 52.15]);
        expect(hit.leg).toBe(1);
        expect(hit.position[0]).toBeCloseTo(21.2, 6);
        expect(hit.position[1]).toBeCloseTo(52.15, 2);
        expect(hit.distance_m).toBeGreaterThan(3000);
    });

    it('podaje najbliższy wierzchołek rzutu', () => {
        const hit = nearestOnRoute(plan, coordinates, [21.09, 51.99]);
        expect(hit.leg).toBe(0);
        expect(hit.vertex).toBe(1);
    });

    it('odcinek z jednym wierzchołkiem (dwa punkty usera w tym samym miejscu)', () => {
        const flat: RoutePlan = {
            ...plan,
            waypoints: [[21, 52], [21.2, 52], [21.2, 52], [21.2, 52.2]],
            legs: [{ start: 0, end: 2, distance_m: 1, duration_s: 1 }, { start: 2, end: 2, distance_m: 0, duration_s: 0 }, { start: 2, end: 4, distance_m: 1, duration_s: 1 }],
        };
        const hit = nearestOnRoute(flat, coordinates, [21.21, 52]);
        expect([0, 1, 2]).toContain(hit.leg);
        expect(hit.vertex).toBe(2);
    });
});

describe('zmiany planu', () => {
    it('przesunięcie startu przelicza pierwszy odcinek', () => {
        expect(moveChange(plan, 0, [20.9, 52])).toEqual({ waypoints: [[20.9, 52], [21.2, 52], [21.2, 52.2]], first: 0, count: 1, added: 0 });
    });

    it('przesunięcie celu przelicza ostatni odcinek', () => {
        expect(moveChange(plan, 2, [21.3, 52.2])).toMatchObject({ first: 1, count: 1, added: 0 });
    });

    it('przesunięcie punktu pośredniego przelicza dwa odcinki', () => {
        expect(moveChange(plan, 1, [21.25, 52])).toEqual({ waypoints: [[21, 52], [21.25, 52], [21.2, 52.2]], first: 0, count: 2, added: 0 });
    });

    it('wstawienie w odcinek 1 dzieli go na dwa', () => {
        expect(insertChange(plan, 1, [21.25, 52.1])).toEqual({
            waypoints: [[21, 52], [21.2, 52], [21.25, 52.1], [21.2, 52.2]], first: 1, count: 1, added: 1,
        });
    });

    it('dopisanie na koniec dodaje odcinek od dotychczasowego celu', () => {
        expect(appendChange(plan, [21.3, 52.3])).toEqual({
            waypoints: [[21, 52], [21.2, 52], [21.2, 52.2], [21.3, 52.3]], first: 2, count: 0, added: 1,
        });
    });

    it('usunięcie punktu pośredniego łączy dwa odcinki', () => {
        expect(removeChange(plan, 1)).toEqual({ waypoints: [[21, 52], [21.2, 52.2]], first: 0, count: 2, added: -1 });
    });

    it('usunięcie startu albo celu zdejmuje skrajny odcinek', () => {
        expect(removeChange(plan, 0)).toEqual({ waypoints: [[21.2, 52], [21.2, 52.2]], first: 0, count: 1, added: -1 });
        expect(removeChange(plan, 2)).toEqual({ waypoints: [[21, 52], [21.2, 52]], first: 1, count: 1, added: -1 });
    });

    it('trasy z dwoma punktami nie da się skrócić', () => {
        const two: RoutePlan = { ...plan, waypoints: [[21, 52], [21.2, 52.2]], legs: [{ start: 0, end: 4, distance_m: 1, duration_s: 1 }] };
        expect(removeChange(two, 0)).toBeNull();
    });

    it('zmiana nie modyfikuje planu', () => {
        const before = JSON.stringify(plan);
        moveChange(plan, 1, [0, 0]);
        insertChange(plan, 0, [0, 0]);
        removeChange(plan, 1);
        expect(JSON.stringify(plan)).toBe(before);
    });
});

describe('waypointLabel', () => {
    it('A, numery, B', () => {
        expect([0, 1, 2, 3].map(i => waypointLabel(i, 4))).toEqual(['A', '1', '2', 'B']);
        expect(waypointLabel(0, 1)).toBe('A');
    });
});

describe('preserveRoutePlan', () => {
    it('zostawia plan, gdy echo trasy ma tę samą geometrię i puste metadata', () => {
        const incoming = { properties: { type: 'b-m-r', metadata: {} } as Record<string, unknown>, geometry: { type: 'LineString', coordinates: coordinates.map(c => [...c]) } };
        preserveRoutePlan(route(), incoming);
        expect((incoming.properties.metadata as { taklab_route: RoutePlan }).taklab_route).toEqual(plan);
    });

    it('zostawia plan, gdy echo nie niesie metadata wcale', () => {
        const incoming = { properties: { type: 'b-m-r' } as Record<string, unknown>, geometry: { type: 'LineString', coordinates } };
        preserveRoutePlan(route(), incoming);
        expect(incoming.properties.metadata).toEqual({ taklab_route: plan });
    });

    it('nie zostawia planu, gdy geometria się zmieniła', () => {
        const incoming = { properties: { type: 'b-m-r', metadata: {} } as Record<string, unknown>, geometry: { type: 'LineString', coordinates: [[21, 52], [22, 53]] } };
        preserveRoutePlan(route(), incoming);
        expect(incoming.properties.metadata).toEqual({});
    });

    it('nie nadpisuje planu, który przyszedł z wejściem', () => {
        const other = { ...plan, mode: 'car' };
        const incoming = { properties: { type: 'b-m-r', metadata: { taklab_route: other } } as Record<string, unknown>, geometry: { type: 'LineString', coordinates } };
        preserveRoutePlan(route(), incoming);
        expect((incoming.properties.metadata as { taklab_route: RoutePlan }).taklab_route.mode).toBe('car');
    });

    it('nie rusza obiektów, które nie są trasą', () => {
        const incoming = { properties: { type: 'u-d-f', metadata: {} } as Record<string, unknown>, geometry: { type: 'LineString', coordinates } };
        preserveRoutePlan({ properties: { type: 'u-d-f', metadata: { taklab_route: plan } }, geometry: { type: 'LineString', coordinates } }, incoming);
        expect(incoming.properties.metadata).toEqual({});
    });
});
