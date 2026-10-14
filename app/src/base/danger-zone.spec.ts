import { describe, expect, it } from 'vitest';
import jsonata from 'jsonata';
import { isDangerZone, setDangerZone, DANGER_ZONE_FILTER, dangerZoneGeometry, dangerZoneChanged } from './danger-zone.ts';

const polygon = (properties: Record<string, unknown>) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52]]] },
});

describe('isDangerZone', () => {
    it('geofence z alarmem przy wejściu albo w obie strony to strefa', () => {
        expect(isDangerZone({ geofence: { trigger: 'Entry' } })).toBe(true);
        expect(isDangerZone({ geofence: { trigger: 'Both' } })).toBe(true);
    });

    it('geofence z alarmem tylko przy wyjściu albo bez wyzwalacza nie jest strefą', () => {
        expect(isDangerZone({ geofence: { trigger: 'Exit' } })).toBe(false);
        expect(isDangerZone({ geofence: { tracking: false } })).toBe(false);
        expect(isDangerZone({})).toBe(false);
    });

    it('stara konwencja: „zamknięt” w nazwie', () => {
        expect(isDangerZone({ callsign: 'Teren ZAMKNIĘTY' })).toBe(true);
    });
});

describe('setDangerZone', () => {
    it('włączenie bez geofence zakłada alarm przy wejściu bez śledzenia', () => {
        expect(setDangerZone(undefined, true)).toEqual({
            trigger: 'Entry', monitor: 'TAKUsers', tracking: false, elevationMonitored: false,
        });
    });

    it('włączenie przy alarmie przy wyjściu daje alarm w obie strony, reszta pól zostaje', () => {
        expect(setDangerZone({ trigger: 'Exit', monitor: 'Hostile', tracking: true }, true))
            .toEqual({ trigger: 'Both', monitor: 'Hostile', tracking: true });
    });

    it('wyłączenie: Entry zdejmuje geofence, Both wraca do Exit', () => {
        expect(setDangerZone({ trigger: 'Entry', monitor: 'TAKUsers' }, false)).toBeUndefined();
        expect(setDangerZone({ trigger: 'Both', monitor: 'All' }, false)).toEqual({ trigger: 'Exit', monitor: 'All' });
    });

    it('bez zmiany stanu zwraca to samo', () => {
        const fence = { trigger: 'Entry' };
        expect(setDangerZone(fence, true)).toBe(fence);
        expect(setDangerZone(undefined, false)).toBeUndefined();
    });
});

describe('DANGER_ZONE_FILTER', () => {
    const matches = async (feature: unknown) => await jsonata(DANGER_ZONE_FILTER).evaluate(feature) === true;

    it('łapie wielokąt z geofence Entry/Both i ze starą nazwą', async () => {
        expect(await matches(polygon({ callsign: 'A', geofence: { trigger: 'Entry' } }))).toBe(true);
        expect(await matches(polygon({ geofence: { trigger: 'Both' } }))).toBe(true);
        expect(await matches(polygon({ callsign: 'teren zamknięty' }))).toBe(true);
    });

    it('pomija zwykły wielokąt, geofence Exit i punkt z geofence', async () => {
        expect(await matches(polygon({ callsign: 'Las' }))).toBe(false);
        expect(await matches(polygon({}))).toBe(false);
        expect(await matches(polygon({ callsign: 'B', geofence: { trigger: 'Exit' } }))).toBe(false);
        expect(await matches({ properties: { geofence: { trigger: 'Entry' } }, geometry: { type: 'Point', coordinates: [21, 52] } })).toBe(false);
    });
});

describe('dangerZoneGeometry i dangerZoneChanged', () => {
    const ring = [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52]]];
    const zone = { properties: { geofence: { trigger: 'Entry' } }, geometry: { type: 'Polygon', coordinates: ring } };

    it('zwraca geometrię tylko dla strefy', () => {
        expect(dangerZoneGeometry(zone)?.coordinates).toEqual(ring);
        expect(dangerZoneGeometry({ ...zone, properties: { callsign: 'Las' } })).toBeNull();
        expect(dangerZoneGeometry({ properties: { geofence: { trigger: 'Entry' } }, geometry: { type: 'Point', coordinates: [21, 52] } })).toBeNull();
        expect(dangerZoneGeometry(undefined)).toBeNull();
    });

    it('zmiana kształtu, włączenie i wyłączenie strefy to zmiana; sama nazwa nie', () => {
        const a = dangerZoneGeometry(zone);
        const moved = dangerZoneGeometry({ ...zone, geometry: { type: 'Polygon', coordinates: [[[21, 52], [21.02, 52], [21.02, 52.01], [21, 52]]] } });
        expect(dangerZoneChanged(a, moved)).toBe(true);
        expect(dangerZoneChanged(null, a)).toBe(true);
        expect(dangerZoneChanged(a, null)).toBe(true);
        expect(dangerZoneChanged(a, dangerZoneGeometry({ ...zone, properties: { ...zone.properties, callsign: 'Nowa' } }))).toBe(false);
        expect(dangerZoneChanged(null, null)).toBe(false);
    });
});
