import { describe, expect, it } from 'vitest';
import { collectThreats, OBSERVER_FILTER, CLOSED_FILTER } from './route-threats.ts';
import type { ThreatFeature, ThreatSource } from './route-threats.ts';

function source(observers: ThreatFeature[], areas: ThreatFeature[]): ThreatSource & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async filter(expression: string) {
            calls.push(expression);
            return expression === OBSERVER_FILTER ? observers : expression === CLOSED_FILTER ? areas : [];
        },
    };
}

const point = (lon: number, lat: number): ThreatFeature => ({ properties: { type: 'a-h-G' }, geometry: { type: 'Point', coordinates: [lon, lat] } });
const square = (lon: number, lat: number): ThreatFeature => ({
    properties: { callsign: 'Teren ZAMKNIĘTY' },
    geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat]]] },
});

describe('collectThreats', () => {
    it('bierze posterunki i tereny zamknięte w pobliżu trasy', async () => {
        const db = source([point(21.01, 52.01), point(25, 50)], [square(21, 52), square(14, 54)]);
        const threats = await collectThreats(db, [[21, 52], [21.05, 52.05]]);
        expect(threats).toEqual({
            observers: [[21.01, 52.01]],
            closed_areas: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52]]],
        });
        expect(db.calls).toEqual([OBSERVER_FILTER, CLOSED_FILTER]);
    });

    it('bez obiektów w pobliżu zwraca undefined', async () => {
        expect(await collectThreats(source([point(25, 50)], []), [[21, 52], [21.05, 52.05]])).toBeUndefined();
    });

    it('najwyżej 50 posterunków, najbliższych trasie', async () => {
        const many = Array.from({ length: 80 }, (_, i) => point(21 + i * 0.0005, 52));
        const threats = await collectThreats(source(many, []), [[21, 52], [21.001, 52.001]]);
        expect(threats?.observers).toHaveLength(50);
        expect(threats?.observers?.[0]).toEqual([21, 52]);
    });
});
