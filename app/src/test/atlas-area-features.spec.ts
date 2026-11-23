import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AtlasDatabase from '../workers/atlas-database.ts';
import Subscription from '../base/subscription.ts';
import COT from '../base/cot.ts';
import type Atlas from '../workers/atlas.ts';
import type { InputFeature } from '../types.ts';

const AREA: [number, number, number, number] = [20.9, 52.1, 21.1, 52.3];

function feature(id: string, geometry: InputFeature['geometry'], extra: Record<string, unknown> = {}): InputFeature {
    const now = Date.now();

    return {
        id,
        type: 'Feature',
        path: '/',
        properties: {
            type: geometry.type === 'Point' ? 'u-d-p' : 'u-d-f',
            how: 'h-g-i-g-o',
            callsign: id,
            archived: true,
            time: new Date(now).toISOString(),
            start: new Date(now).toISOString(),
            stale: new Date(now + 60 * 60 * 1000).toISOString(),
            ...extra,
        },
        geometry,
    } as unknown as InputFeature;
}

async function setup(missionFeatures: InputFeature[] = []) {
    const atlas = {
        token: 'token',
        postMessage: vi.fn(async () => {}),
        profile: {
            uid: async () => 'me',
            creator: async () => ({ uid: 'me', type: 'a-f-G-E-V-C', callsign: 'ME', time: '2026-01-01T00:00:00Z' }),
        },
    } as unknown as Atlas;

    vi.spyOn(Subscription, 'from').mockImplementation(async () => ({
        feature: {
            list: async () => missionFeatures,
        },
    }) as unknown as Subscription);

    const store = new AtlasDatabase(atlas);

    const add = async (feat: InputFeature) => {
        await store.add(feat, { skipSave: true, skipBroadcast: true });
    };

    return { store, add };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AtlasDatabase.areaFeatures', () => {
    it('returns markers, shapes and routes in the area and skips people', async () => {
        const { store, add } = await setup();

        await add(feature('inside', { type: 'Point', coordinates: [21, 52.2] }));
        await add(feature('outside', { type: 'Point', coordinates: [19, 50] }));
        await add(feature('contact', { type: 'Point', coordinates: [21, 52.2] }, {
            type: 'a-f-G-U-C',
            group: { name: 'Cyan', role: 'Team Member' },
        }));
        await add(feature('route', {
            type: 'LineString',
            coordinates: [[20.5, 52.2], [21.05, 52.2]],
        }, { type: 'b-m-r' }));
        await add(feature('shape', {
            type: 'Polygon',
            coordinates: [[[21.0, 52.15], [21.02, 52.15], [21.02, 52.17], [21.0, 52.15]]],
        }));

        const found = await store.areaFeatures(AREA);
        const byId = Object.fromEntries(found.map((f) => [f.id, f]));

        expect(Object.keys(byId).sort()).toEqual(['inside', 'route', 'shape']);
        expect(byId.inside.kind).toBe('marker');
        expect(byId.route.kind).toBe('route');
        expect(byId.shape.kind).toBe('shape');
        expect(byId.inside.title).toBe('inside');
        expect(byId.inside.feature.properties.callsign).toBe('inside');
        expect(byId.inside.feature.geometry).toEqual({ type: 'Point', coordinates: [21, 52.2] });
    });

    it('skips the own position marker', async () => {
        const { store, add } = await setup();
        await add(feature('me-uid', { type: 'Point', coordinates: [21, 52.2] }));

        const before = COT.selfUid;
        COT.selfUid = 'me-uid';
        try {
            expect(await store.areaFeatures(AREA)).toEqual([]);
        } finally {
            COT.selfUid = before;
        }
    });

    it('includes objects of visible missions, once', async () => {
        const mission = feature('mission-point', { type: 'Point', coordinates: [21.01, 52.21] });
        const dupe = feature('inside', { type: 'Point', coordinates: [21, 52.2] });
        const { store, add } = await setup([mission, dupe]);

        await add(feature('inside', { type: 'Point', coordinates: [21, 52.2] }));

        const found = await store.areaFeatures(AREA, ['mission-guid']);
        expect(found.map((f) => f.id).sort()).toEqual(['inside', 'mission-point']);
    });

    it('ignores missions that are not passed as visible', async () => {
        const mission = feature('mission-point', { type: 'Point', coordinates: [21.01, 52.21] });
        const { store } = await setup([mission]);

        expect(await store.areaFeatures(AREA)).toEqual([]);
    });
});
