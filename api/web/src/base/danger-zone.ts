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
