import { describe, expect, it } from 'vitest';
import {
    buildMapSnapshot,
    mapSnapshotFeature,
    snapshotKind,
    MAP_SNAPSHOT_MAX_BYTES,
    MAP_SNAPSHOT_MAX_ITEMS,
} from './taklab-map-snapshot.ts';
import type { MapSnapshotFeature, MapSnapshotSource } from './taklab-map-snapshot.ts';

function feature(id: string, lon: number, lat: number, extra: Partial<MapSnapshotFeature> = {}): MapSnapshotFeature {
    return {
        id,
        callsign: id,
        type: 'a-f-G',
        geometry: 'Point',
        point: [lon, lat],
        ...extra,
    };
}

function source(extra: Partial<MapSnapshotSource> = {}): MapSnapshotSource {
    return {
        now: new Date('2026-09-26T16:40:00.123Z'),
        view: {
            lat: 51.1,
            lon: 17.03,
            bearing: 0,
            tilt: 0,
            bbox: [16.98, 51.08, 17.08, 51.12],
        },
        layers: [],
        features: [],
        ...extra,
    };
}

describe('snapshotKind', () => {
    it.each([
        ['b-m-r', 'LineString', 'route'],
        ['b-m-r', 'Point', 'route'],
        ['u-d-f', 'LineString', 'shape'],
        ['u-d-r', 'Polygon', 'shape'],
        ['u-d-c-c', 'Polygon', 'shape'],
        ['a-f-G', 'Polygon', 'shape'],
        ['u-d-p', 'Point', 'drawing'],
        ['u-d-f-m', 'LineString', 'shape'],
        ['u-rb-a', 'LineString', 'other'],
        ['a-f-G-U-C', 'Point', 'marker'],
        ['a-h-G', 'Point', 'marker'],
        ['a-f-G', 'LineString', 'other'],
        ['b-t-f', 'Point', 'other'],
        ['', 'Point', 'other'],
    ])('%s / %s -> %s', (type, geometry, kind) => {
        expect(snapshotKind(type, geometry)).toBe(kind);
    });
});

describe('mapSnapshotFeature', () => {
    it('uses the precomputed center', () => {
        expect(mapSnapshotFeature({
            id: 'r1',
            properties: { callsign: 'Trasa', type: 'b-m-r', remarks: 'x', center: [17.01, 51.1, 120] },
            geometry: { type: 'LineString', coordinates: [[17, 51.1], [17.02, 51.1]] },
        })).toEqual({ id: 'r1', callsign: 'Trasa', type: 'b-m-r', remarks: 'x', geometry: 'LineString', point: [17.01, 51.1] });
    });

    it('falls back to the point geometry', () => {
        expect(mapSnapshotFeature({
            id: 'p1',
            properties: { callsign: 'PK1', type: 'a-f-G' },
            geometry: { type: 'Point', coordinates: [17.02, 51.105, 0] },
        })?.point).toEqual([17.02, 51.105]);
    });

    it('falls back to a point on the geometry', () => {
        const point = mapSnapshotFeature({
            id: 'r2',
            properties: { type: 'b-m-r' },
            geometry: { type: 'LineString', coordinates: [[17, 51.1], [17.02, 51.1]] },
        })?.point;

        expect(point?.[0]).toBeCloseTo(17.01, 6);
        expect(point?.[1]).toBeCloseTo(51.1, 6);
    });

    it('returns undefined without a usable point', () => {
        expect(mapSnapshotFeature({
            id: 'x',
            properties: { type: 'b-m-r' },
            geometry: { type: 'LineString', coordinates: [] },
        })).toBeUndefined();
    });
});

describe('buildMapSnapshot', () => {
    it('describes the view, basemap, layers and position', () => {
        const snap = buildMapSnapshot(source({
            self: { lat: 51.11, lon: 17.03, callsign: 'kaszub' },
            basemap: 'Google Hybrid',
            layers: ['Granice gmin', 'DTED'],
            view: { lat: 0, lon: 0.5, bearing: 12.34, tilt: 30, bbox: [0, -0.5, 1, 0.5] },
        }));

        expect(snap.v).toBe(1);
        expect(snap.t).toBe('2026-09-26T16:40:00Z');
        expect(snap.self).toEqual({ lat: 51.11, lon: 17.03, callsign: 'kaszub' });
        expect(snap.basemap).toBe('Google Hybrid');
        expect(snap.layers).toEqual(['Granice gmin', 'DTED']);
        expect(snap.view).toMatchObject({ lat: 0, lon: 0.5, bearing: 12.34, tilt: 30, bbox: [0, -0.5, 1, 0.5] });
        // One degree of longitude on the equator
        expect(snap.view.scale_m).toBeGreaterThan(111000);
        expect(snap.view.scale_m).toBeLessThan(111400);
        expect(Number.isInteger(snap.view.scale_m)).toBe(true);
        expect(snap.items).toEqual([]);
        expect(snap.outside).toEqual({});
    });

    it('omits self and basemap when unknown', () => {
        const snap = buildMapSnapshot(source());
        expect('self' in snap).toBe(false);
        expect('basemap' in snap).toBe(false);
    });

    it('selects features in the bbox, nearest first, and counts the rest by kind', () => {
        const snap = buildMapSnapshot(source({
            features: [
                feature('far', 17.07, 51.11),
                feature('near', 17.031, 51.1, { remarks: 'punkt kontrolny' }),
                feature('route', 17.05, 51.1, { type: 'b-m-r', geometry: 'LineString' }),
                feature('out-marker-1', 18, 51.1),
                feature('out-marker-2', 17.03, 52),
                feature('out-route', 16, 50, { type: 'b-m-r', geometry: 'LineString' }),
            ],
        }));

        expect(snap.items.map(i => i.name)).toEqual(['near', 'route', 'far']);
        expect(snap.items[0]).toEqual({
            name: 'near',
            kind: 'marker',
            type: 'a-f-G',
            lat: 51.1,
            lon: 17.031,
            remarks: 'punkt kontrolny',
            dist_m: 70,
        });
        expect(snap.items[1].kind).toBe('route');
        expect(snap.outside).toEqual({ marker: 2, route: 1 });
    });

    it('skips the user own marker', () => {
        const snap = buildMapSnapshot(source({
            selfUid: 'ANDROID-CloudTAK-kaszub',
            features: [feature('ANDROID-CloudTAK-kaszub', 17.03, 51.1), feature('PK1', 17.03, 51.1), feature('me-out', 20, 51, { id: 'ANDROID-CloudTAK-kaszub' })],
        }));

        expect(snap.items.map(i => i.name)).toEqual(['PK1']);
        expect(snap.outside).toEqual({});
    });

    it('keeps at most 40 items', () => {
        const features = [];
        for (let i = 0; i < 50; i++) features.push(feature(`m${i}`, 17.03 + i * 0.0009, 51.1));

        const snap = buildMapSnapshot(source({ features }));

        expect(snap.items).toHaveLength(MAP_SNAPSHOT_MAX_ITEMS);
        expect(snap.items[39].name).toBe('m39');
        expect(snap.outside).toEqual({});
    });

    it('trims items from the end until the JSON fits in 30 KB', () => {
        const features = [];
        for (let i = 0; i < 20; i++) features.push(feature(`m${i}`, 17.03 + i * 0.001, 51.1, { remarks: 'ż'.repeat(1000) }));

        const snap = buildMapSnapshot(source({ features }));
        const bytes = new TextEncoder().encode(JSON.stringify(snap)).length;

        expect(bytes).toBeLessThanOrEqual(MAP_SNAPSHOT_MAX_BYTES);
        // ~2 KB per item: 20 items do not fit, 14 do
        expect(snap.items.length).toBe(14);
        expect(snap.items.at(-1)?.name).toBe('m13');
    });

    it('handles a view across the antimeridian', () => {
        const snap = buildMapSnapshot(source({
            view: { lat: 0, lon: 180, bearing: 0, tilt: 0, bbox: [179, -1, 181, 1] },
            features: [feature('east', -179.5, 0), feature('west', 179.5, 0), feature('away', 0, 0)],
        }));

        expect(snap.items.map(i => i.name).sort()).toEqual(['east', 'west']);
        expect(snap.outside).toEqual({ marker: 1 });
        expect(snap.view.bbox).toEqual([179, -1, -179, 1]);
        expect(snap.view.lon).toBe(180);
    });

    it('normalises the bearing to 0-360', () => {
        const snap = buildMapSnapshot(source({
            view: { lat: 51.1, lon: 17.03, bearing: -90, tilt: 0, bbox: [16.98, 51.08, 17.08, 51.12] },
        }));

        expect(snap.view.bearing).toBe(270);
    });

    it('rounds coordinates and view values', () => {
        const snap = buildMapSnapshot(source({
            view: { lat: 51.123456789, lon: 17.123456789, bearing: 359.99999, tilt: 10.123456, bbox: [16.98, 51.08, 17.28, 51.22] },
            features: [feature('p', 17.1234567891, 51.1234567891)],
        }));

        expect(snap.view.lat).toBe(51.123457);
        expect(snap.view.lon).toBe(17.123457);
        expect(snap.items[0].lat).toBe(51.123457);
        expect(snap.items[0].lon).toBe(17.123457);
    });
});
