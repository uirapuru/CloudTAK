import { describe, it, expect, vi } from 'vitest';
import AtlasDatabase, { dropRemovedKeys } from '../workers/atlas-database.ts';
import type Atlas from '../workers/atlas.ts';
import type { Feature } from '../types.ts';
import { WorkerMessageType } from '../utils/events.ts';

const ring = [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]];
const movedRing = [[[21.1, 52], [21.11, 52], [21.11, 52.01], [21.1, 52.01], [21.1, 52]]];

function zone(coordinates = ring, properties: Record<string, unknown> = { geofence: { trigger: 'Entry' } }) {
    return {
        id: 'zone-1',
        origin: { mode: 'Connection' },
        properties: { id: 'zone-1', type: 'u-d-r', callsign: 'Strefa', ...properties } as Record<string, unknown>,
        geometry: { type: 'Polygon', coordinates },
        as_feature() { return { id: 'zone-1', type: 'Feature', path: '/', properties: this.properties, geometry: this.geometry }; },
    };
}

function setup(existing: ReturnType<typeof zone> | undefined) {
    const postMessage = vi.fn();
    const database = new AtlasDatabase({ postMessage } as unknown as Atlas);
    vi.spyOn(database, 'get').mockResolvedValue(existing as never);
    // Właściwy zapis nie jest tu przedmiotem testu: zwraca obiekt w nowym stanie
    vi.spyOn(database as unknown as { addFeature(f: Feature): Promise<unknown> }, 'addFeature')
        .mockImplementation(async (f: Feature) => ({ ...f }));
    const zoneMessages = () => postMessage.mock.calls.map((c) => c[0]).filter((m) => m.type === WorkerMessageType.Danger_Zone_Changed);
    return { database, zoneMessages };
}

const feature = (z: ReturnType<typeof zone>) => z.as_feature() as unknown as Feature;

describe('AtlasDatabase: zmiana strefy niebezpiecznej', () => {
    it('przesunięcie strefy przez usera wysyła stare i nowe położenie', async () => {
        const { database, zoneMessages } = setup(zone());
        await database.add(feature(zone(movedRing)), { authored: true });
        expect(zoneMessages()).toEqual([{
            type: WorkerMessageType.Danger_Zone_Changed,
            body: { id: 'zone-1', before: { type: 'Polygon', coordinates: ring }, after: { type: 'Polygon', coordinates: movedRing } },
        }]);
    });

    it('wyłączenie strefy wysyła samo stare położenie', async () => {
        const { database, zoneMessages } = setup(zone());
        await database.add(feature(zone(ring, {})), { authored: true });
        expect(zoneMessages()[0].body.after).toBeNull();
    });

    it('zmiana samej nazwy niczego nie wysyła', async () => {
        const { database, zoneMessages } = setup(zone());
        await database.add(feature(zone(ring, { geofence: { trigger: 'Entry' }, callsign: 'Nowa nazwa' })), { authored: true });
        expect(zoneMessages()).toEqual([]);
    });

    it('echo z serwera (bez authored) niczego nie wysyła', async () => {
        const { database, zoneMessages } = setup(zone());
        await database.add(feature(zone(movedRing)));
        expect(zoneMessages()).toEqual([]);
    });

    it('usunięcie strefy przez usera wysyła stare położenie, echo usunięcia nie', async () => {
        const authored = setup(zone());
        await authored.database.remove('zone-1', { authored: true }).catch(() => undefined);
        expect(authored.zoneMessages()[0].body).toEqual({ id: 'zone-1', before: { type: 'Polygon', coordinates: ring }, after: null });

        const echo = setup(zone());
        await echo.database.remove('zone-1', { skipNetwork: true }).catch(() => undefined);
        expect(echo.zoneMessages()).toEqual([]);
    });
});

describe('dropRemovedKeys: wyłączenie strefy zdejmuje geofence', () => {
    it('zapis usera bez geofence usuwa go z zapisanej figury (Object.assign klucza nie usuwa)', () => {
        const existing = zone();
        dropRemovedKeys(existing.properties, zone(ring, {}).properties);
        expect('geofence' in existing.properties).toBe(false);
    });

    it('geofence obecny w nowej wersji zostaje, inne pola nietknięte', () => {
        const existing = zone(ring, { geofence: { trigger: 'Entry' }, remarks: 'x' });
        dropRemovedKeys(existing.properties, zone(ring, { geofence: { trigger: 'Both' } }).properties);
        expect(existing.properties.geofence).toEqual({ trigger: 'Entry' });
        expect(existing.properties.remarks).toBe('x');
    });
});
