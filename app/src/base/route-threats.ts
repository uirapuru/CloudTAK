/**
 * Zagrożenia z mapy dla liczenia trasy: wrogie znaczniki (typ CoT a-h-*) jako
 * posterunki obserwacyjne i strefy niebezpieczne (base/danger-zone.ts) jako tereny
 * zamknięte. Tylko obiekty do 5 km od prostokąta punktów trasy.
 *
 * Znane ograniczenie: wielokąt, który całkiem obejmuje prostokąt bez wierzchołka
 * w jego wnętrzu, zostanie pominięty.
 */
import type { LngLat, RouteThreats } from './route-plan.ts';
import { DANGER_ZONE_FILTER } from './danger-zone.ts';

export const OBSERVER_FILTER = '$substring(properties.type, 0, 4) = "a-h-" and geometry.type = "Point"';
export const CLOSED_FILTER = DANGER_ZONE_FILTER;

export const THREAT_RADIUS_M = 5000;
export const MAX_THREATS = 50;

export type ThreatFeature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
export type ThreatSource = { filter(expression: string, opts?: { mission?: boolean }): Promise<Iterable<ThreatFeature>> };

type Box = { west: number; east: number; south: number; north: number };

function box(points: LngLat[]): Box {
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
    const dLat = THREAT_RADIUS_M / 111320;
    const dLon = THREAT_RADIUS_M / (111320 * Math.cos(mid * Math.PI / 180));
    return {
        west: Math.min(...lons) - dLon, east: Math.max(...lons) + dLon,
        south: Math.min(...lats) - dLat, north: Math.max(...lats) + dLat,
    };
}

function inside(b: Box, p: LngLat): boolean {
    return p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north;
}

function isPoint(value: unknown): value is LngLat {
    return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

// Odległość (w stopniach, do porządkowania) do najbliższego punktu trasy
function nearest(points: LngLat[], p: LngLat): number {
    return Math.min(...points.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
}

export async function collectThreats(db: ThreatSource, points: LngLat[]): Promise<RouteThreats | undefined> {
    if (!points.length) return undefined;
    const b = box(points);

    const observers: LngLat[] = [];
    for (const f of await db.filter(OBSERVER_FILTER, { mission: true })) {
        const c = f.geometry.coordinates;
        if (isPoint(c) && inside(b, [c[0], c[1]])) observers.push([c[0], c[1]]);
    }
    // Najbliższe trasie pierwsze; przy limicie odpadają najdalsze
    observers.sort((p, q) => nearest(points, p) - nearest(points, q));

    const areas: LngLat[][] = [];
    for (const f of await db.filter(CLOSED_FILTER, { mission: true })) {
        const rings = f.geometry.coordinates;
        const ring: unknown = Array.isArray(rings) ? rings[0] : undefined;
        if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPoint)) continue;
        const outer = ring.map((p: LngLat) => [p[0], p[1]] as LngLat);
        if (outer.some((p) => inside(b, p))) areas.push(outer);
    }

    const threats: RouteThreats = {};
    if (observers.length) threats.observers = observers.slice(0, MAX_THREATS);
    if (areas.length) threats.closed_areas = areas.slice(0, MAX_THREATS);
    return Object.keys(threats).length ? threats : undefined;
}
