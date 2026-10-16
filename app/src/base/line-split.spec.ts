import { describe, expect, it } from 'vitest';
import { splitLineFeatures } from './line-split.ts';
import type { Feature } from '../types.ts';

const plan = {
    version: 1, mode: 'foot', mode_name: 'Pieszo',
    waypoints: [[21, 52], [21.2, 52.2]],
    legs: [{ start: 0, end: 2, distance_m: 1, duration_s: 1 }],
};

function source() {
    return {
        path: '/trasy/',
        properties: {
            id: 'route-1', type: 'b-m-r', callsign: 'Trasa', archived: true,
            time: '2026-10-16T00:00:00Z', start: '2026-10-16T00:00:00Z', stale: '2026-10-17T00:00:00Z',
            metadata: { taklab_route: plan, note: { text: 'x' } },
        } as unknown as Feature['properties'],
    };
}

const a = { id: 'a', coordinates: [[21, 52], [21.1, 52.1]] as [number, number][] };
const b = { id: 'b', coordinates: [[21.1, 52.1], [21.2, 52.2]] as [number, number][] };
const now = new Date('2026-10-16T12:00:00Z');

describe('splitLineFeatures', () => {
    it('obie połówki tracą plan trasy, reszta metadata zostaje', () => {
        const [featA, featB] = splitLineFeatures(source(), a, b, now);
        for (const feat of [featA, featB]) {
            const metadata = (feat.properties as { metadata: Record<string, unknown> }).metadata;
            expect(metadata).not.toHaveProperty('taklab_route');
            expect(metadata.note).toEqual({ text: 'x' });
        }
    });

    it('połówki mają własne kopie metadata, źródło zostaje nietknięte', () => {
        const src = source();
        const [featA, featB] = splitLineFeatures(src, a, b, now);
        const metaA = (featA.properties as unknown as { metadata: { note: { text: string } } }).metadata;
        const metaB = (featB.properties as unknown as { metadata: { note: { text: string } } }).metadata;
        expect(metaA).not.toBe(metaB);
        metaA.note.text = 'zmiana';
        expect(metaB.note.text).toBe('x');
        expect((src.properties as { metadata: Record<string, unknown> }).metadata.taklab_route).toBe(plan);
    });

    it('identyfikatory, nazwy, czas i geometria połówek', () => {
        const [featA, featB] = splitLineFeatures(source(), a, b, now);
        expect([featA.id, featA.properties.id, featB.id, featB.properties.id]).toEqual(['a', 'a', 'b', 'b']);
        expect([featA.properties.callsign, featB.properties.callsign]).toEqual(['Trasa (1)', 'Trasa (2)']);
        expect(featA.properties.time).toBe(now.toISOString());
        expect(featA.path).toBe('/trasy/');
        expect(featB.geometry).toEqual({ type: 'LineString', coordinates: b.coordinates });
    });

    it('linia bez metadata: bez pola metadata', () => {
        const src = source();
        delete (src.properties as { metadata?: unknown }).metadata;
        const [featA] = splitLineFeatures(src, a, b, now);
        expect(featA.properties).not.toHaveProperty('metadata');
    });
});
