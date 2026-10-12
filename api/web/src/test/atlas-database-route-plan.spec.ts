import { describe, it, expect, vi } from 'vitest';
import AtlasDatabase from '../workers/atlas-database.ts';
import type Atlas from '../workers/atlas.ts';
import type { Feature } from '../types.ts';

const coordinates = [[21, 52], [21.1, 52.1]];
const plan = {
    version: 1,
    mode: 'foot',
    mode_name: 'Pieszo',
    waypoints: [[21, 52], [21.1, 52.1]],
    legs: [{ start: 0, end: 1, distance_m: 1, duration_s: 1 }],
};

function setup() {
    const existing = {
        id: 'route-1',
        origin: { mode: 'Connection' },
        is_self: false,
        is_skittle: false,
        geometry: { type: 'LineString', coordinates },
        properties: { id: 'route-1', type: 'b-m-r', metadata: { taklab_route: plan } },
        as_feature() {
            return { id: 'route-1', type: 'Feature', path: '/', properties: this.properties, geometry: this.geometry };
        },
        update: vi.fn<(update: unknown) => Promise<boolean>>(async () => true),
    };

    const database = new AtlasDatabase({ postMessage: vi.fn() } as unknown as Atlas);
    vi.spyOn(database, 'get').mockResolvedValue(existing as never);
    return { database, existing };
}

function incoming(geometry = coordinates): Feature {
    return {
        id: 'route-1',
        type: 'Feature',
        path: '/',
        properties: { id: 'route-1', type: 'b-m-r', callsign: 'Trasa', metadata: {} },
        geometry: { type: 'LineString', coordinates: geometry },
    } as unknown as Feature;
}

describe('AtlasDatabase.add: plan trasy a echo z serwera TAK', () => {
    it('zostawia plan, gdy trasa wraca z serwera z tą samą geometrią', async () => {
        const { database, existing } = setup();
        await database.add(incoming());
        const update = existing.update.mock.calls[0][0] as unknown as { properties: { metadata: Record<string, unknown> } };
        expect(update.properties.metadata.taklab_route).toEqual(plan);
    });

    it('nie zostawia planu, gdy geometria trasy się zmieniła', async () => {
        const { database, existing } = setup();
        await database.add(incoming([[21, 52], [22, 53]]));
        const update = existing.update.mock.calls[0][0] as unknown as { properties: { metadata: Record<string, unknown> } };
        expect(update.properties.metadata).toEqual({});
    });

    it('zmiana napisana przez tego klienta wygrywa', async () => {
        const { database, existing } = setup();
        await database.add(incoming(), { authored: true });
        const update = existing.update.mock.calls[0][0] as unknown as { properties: { metadata: Record<string, unknown> } };
        expect(update.properties.metadata).toEqual({});
    });
});
