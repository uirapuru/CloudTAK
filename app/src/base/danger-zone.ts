/**
 * Strefa niebezpieczna: figura, którą trasy taklab omijają. Znacznikiem jest geofence ATAK
 * (`__geofence` w CoT) z alarmem przy wejściu (trigger Entry albo Both), bo tylko on
 * przechodzi przez serwer TAK i trafia do ATAK; properties.metadata echo serwera gubi.
 * Stara konwencja z nazwą zawierającą „zamknięt” dalej działa.
 */

export type Geofence = {
    trigger?: string;
    monitor?: string;
    tracking?: boolean;
    elevationMonitored?: boolean;
    [key: string]: unknown;
};

const ENTRY_TRIGGERS = ['Entry', 'Both'];

/** Wielokąty-strefy w bazie mapy (wyrażenie JSONata dla AtlasDatabase.filter). */
export const DANGER_ZONE_FILTER = 'geometry.type = "Polygon" and ('
    + 'properties.geofence.trigger in ["Entry", "Both"]'
    + ' or $contains($lowercase(properties.callsign), "zamknięt"))';

export function isDangerZone(properties: { geofence?: Geofence; callsign?: unknown }): boolean {
    if (ENTRY_TRIGGERS.includes(String(properties.geofence?.trigger))) return true;
    return typeof properties.callsign === 'string' && properties.callsign.toLowerCase().includes('zamknięt');
}

/**
 * Geofence po włączeniu albo wyłączeniu strefy. Nowa strefa dostaje alarm przy wejściu
 * użytkowników TAK, ale bez śledzenia, więc ATAK sam nie włączy alarmu. Istniejący
 * geofence z alarmem przy wyjściu zachowuje go (Exit ↔ Both).
 */
export function setDangerZone(geofence: Geofence | undefined, on: boolean): Geofence | undefined {
    const active = ENTRY_TRIGGERS.includes(String(geofence?.trigger));
    if (on === active) return geofence;

    if (on) {
        if (!geofence) return { trigger: 'Entry', monitor: 'TAKUsers', tracking: false, elevationMonitored: false };
        return { ...geofence, trigger: geofence.trigger === 'Exit' ? 'Both' : 'Entry' };
    }

    if (geofence?.trigger === 'Both') return { ...geofence, trigger: 'Exit' };
    return undefined;
}

type ZoneSource = { geometry?: { type: string; coordinates?: unknown } | null; properties?: Record<string, unknown> };

/** Geometria wielokąta, gdy obiekt jest strefą niebezpieczną; inaczej null. */
export function dangerZoneGeometry(feature: ZoneSource | null | undefined): { type: 'Polygon'; coordinates: number[][][] } | null {
    if (!feature?.geometry || feature.geometry.type !== 'Polygon' || !feature.properties) return null;
    if (!isDangerZone(feature.properties as { geofence?: Geofence; callsign?: unknown })) return null;
    return { type: 'Polygon', coordinates: structuredClone(feature.geometry.coordinates) as number[][][] };
}

/** Czy zmiana dotyczy trasy: strefa powstała, zniknęła albo zmieniła kształt lub położenie. */
export function dangerZoneChanged(before: ReturnType<typeof dangerZoneGeometry>, after: ReturnType<typeof dangerZoneGeometry>): boolean {
    if (!before && !after) return false;
    return JSON.stringify(before?.coordinates ?? null) !== JSON.stringify(after?.coordinates ?? null);
}
